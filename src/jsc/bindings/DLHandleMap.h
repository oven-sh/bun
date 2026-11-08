#pragma once

#include "root.h"
#include "v8/node.h"
#include "napi.h"
#include <JavaScriptCore/VM.h>
#include <wtf/HashMap.h>
#include <wtf/Lock.h>
#include <wtf/Vector.h>
#include <variant>
#include <mutex>
#include <optional>

#if OS(WINDOWS)
#include <windows.h>
#endif

namespace Bun {

struct V8ModuleRegistration {
    node::node_module* module;

    // The live VM that last ran this module's init. Only set if bindsToVM(). See claimForVM and vmDestroyed.
    std::optional<JSC::VMIdentifier> owner;

    // True if only one live VM at a time may run the init. A context-unaware init (NODE_MODULE, NAN) keeps its handles in statics.
    static bool bindsToVM(const node::node_module& mod)
    {
        return !mod.nm_context_register_func && mod.nm_register_func && mod.nm_version == REPORTED_NODEJS_ABI_VERSION;
    }
};

// A module can be either V8 C++ style or NAPI style
using DLModuleRegistration = std::variant<V8ModuleRegistration, napi_module*>;

// Thread-safe map for tracking dlopen handles to module registrations.
// This allows re-loading the same native module multiple times, matching Node.js behavior.
//
// A single .node file can register multiple modules (both NAPI and V8 C++), so we store
// a vector of registrations per handle. When a native module is loaded for the first time,
// its static constructors run and call node_module_register() or napi_module_register().
// On subsequent loads, dlopen() returns the same handle but the constructors don't run again.
// We use this map to look up and replay all saved registrations.
//
// Node.js rejects any second load of a bindsToVM() module. Bun rejects it only while another live VM owns the module.
class DLHandleMap {
public:
#if OS(WINDOWS)
    using DLHandle = HMODULE;
#else
    using DLHandle = void*;
#endif

    // Get the singleton instance
    static DLHandleMap& singleton()
    {
        static std::once_flag s_onceFlag;
        static DLHandleMap* s_instance = nullptr;
        std::call_once(s_onceFlag, [] {
            s_instance = new DLHandleMap();
        });
        return *s_instance;
    }

    // Add a V8 C++ module registration to the vector for this handle. `vm` is about to run its init.
    void add(DLHandle handle, node::node_module* module, JSC::VM& vm)
    {
        ASSERT(handle != nullptr);
        ASSERT(module != nullptr);

        std::optional<JSC::VMIdentifier> owner;
        if (V8ModuleRegistration::bindsToVM(*module))
            owner = vm.identifier();

        WTF::Locker locker { m_lock };
        auto& registrations = m_map.ensure(handle, [] { return WTF::Vector<DLModuleRegistration>(); }).iterator->value;
        registrations.append(DLModuleRegistration(V8ModuleRegistration { module, owner }));
    }

    // Add a NAPI module registration to the vector for this handle
    void add(DLHandle handle, napi_module* module)
    {
        ASSERT(handle != nullptr);
        ASSERT(module != nullptr);

        WTF::Locker locker { m_lock };
        auto& registrations = m_map.ensure(handle, [] { return WTF::Vector<DLModuleRegistration>(); }).iterator->value;
        registrations.append(DLModuleRegistration(module));
    }

    // Look up all previously saved module registrations for this handle
    std::optional<WTF::Vector<DLModuleRegistration>> get(DLHandle handle)
    {
        ASSERT(handle != nullptr);

        WTF::Locker locker { m_lock };

        auto it = m_map.find(handle);
        if (it == m_map.end()) {
            return std::nullopt;
        }

        return it->value;
    }

    // Makes `vm` the owner of this handle's bindsToVM() modules. Returns false without changing anything if another live VM owns one.
    bool claimForVM(DLHandle handle, JSC::VM& vm)
    {
        ASSERT(handle != nullptr);
        auto identifier = vm.identifier();

        WTF::Locker locker { m_lock };

        auto it = m_map.find(handle);
        ASSERT(it != m_map.end());
        if (it == m_map.end()) {
            return true;
        }

        auto& registrations = it->value;
        for (auto& registration : registrations) {
            auto* v8Module = std::get_if<V8ModuleRegistration>(&registration);
            if (v8Module && v8Module->owner && *v8Module->owner != identifier) {
                return false;
            }
        }

        for (auto& registration : registrations) {
            auto* v8Module = std::get_if<V8ModuleRegistration>(&registration);
            if (v8Module && V8ModuleRegistration::bindsToVM(*v8Module->module)) {
                v8Module->owner = identifier;
            }
        }

        return true;
    }

    // Releases the modules a destroyed VM owned so another VM can claim them.
    void vmDestroyed(JSC::VMIdentifier identifier)
    {
        WTF::Locker locker { m_lock };

        for (auto& registrations : m_map.values()) {
            for (auto& registration : registrations) {
                auto* v8Module = std::get_if<V8ModuleRegistration>(&registration);
                if (v8Module && v8Module->owner == identifier) {
                    v8Module->owner.reset();
                }
            }
        }
    }

private:
    DLHandleMap() = default;
    ~DLHandleMap() = default;

    DLHandleMap(const DLHandleMap&) = delete;
    DLHandleMap& operator=(const DLHandleMap&) = delete;

    WTF::Lock m_lock;
    WTF::HashMap<DLHandle, WTF::Vector<DLModuleRegistration>> m_map;
};

} // namespace Bun
