#pragma once

#include "root.h"
#include "v8/node.h"
#include "napi.h"
#include <JavaScriptCore/VM.h>
#include <wtf/HashMap.h>
#include <wtf/Lock.h>
#include <wtf/RecursiveLockAdapter.h>
#include <wtf/Vector.h>
#include <variant>
#include <mutex>

#if OS(WINDOWS)
#include <windows.h>
#endif

namespace Bun {

struct V8ModuleRegistration {
    node::node_module* module;

    // True if only one live VM at a time may run the init. A context-unaware init (NODE_MODULE, NAN) keeps its handles in statics.
    static bool bindsToVM(const node::node_module& mod)
    {
        return !mod.nm_context_register_func && mod.nm_register_func && mod.nm_version == REPORTED_NODEJS_ABI_VERSION;
    }
};

// A module can be either V8 C++ style or NAPI style
using DLModuleRegistration = std::variant<V8ModuleRegistration, napi_module*>;

// Loads native addons and remembers what each one registered.
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

    struct Loaded {
        enum class Kind : uint8_t {
            // The loader returned no handle.
            Failed,
            // This load ran the library's static constructors. `napiModules` and `v8Modules` are what they registered.
            SelfRegistered,
            // An earlier load saved `registrations`.
            Replay,
            // Another live VM owns a bindsToVM() module of the library.
            OwnedByAnotherVM,
            // No load of the library registered a module.
            Unregistered,
        };

        DLHandle handle { nullptr };
        Kind kind { Kind::Failed };
        WTF::Vector<napi_module> napiModules;
        WTF::Vector<node::node_module*> v8Modules;
        WTF::Vector<DLModuleRegistration> registrations;
    };

    // Calls `loader` (dlopen or LoadLibrary) on this thread, then saves the registrations that the library's static
    // constructors left in the queues of `globalObject`, or looks up what an earlier load saved. One lock covers all of
    // it: the constructors run only for the first thread, and any other thread that got the handle before the
    // registrations were saved would find none. Node.js holds dlib_load_mutex over the same steps:
    // https://github.com/nodejs/node/blob/b7e6a5d37e7a14ef0f2cc95214b95d66c4081415/src/node_binding.cc#L477-L562
    //
    // `loader` returns null if the load failed. No init function runs here, because it can take long and it can call
    // process.dlopen(). Node.js runs the init functions that it finds by symbol with its lock held, and a nested load
    // hangs there. The lock is recursive because a static constructor can also run JS that calls process.dlopen().
    template<typename Loader>
    ALWAYS_INLINE Loaded load(Zig::GlobalObject& globalObject, NOESCAPE const Loader& loader)
    {
        Loaded loaded;
        WTF::Locker locker { m_lock };

        loaded.handle = loader();
        if (!loaded.handle)
            return loaded;

        auto& vm = JSC::getVM(&globalObject);
        if (globalObject.napiModuleRegisterCallCount != 0) {
            loaded.kind = Loaded::Kind::SelfRegistered;
            loaded.napiModules.swap(globalObject.m_pendingNapiModules);
            loaded.v8Modules.swap(globalObject.m_pendingV8Modules);
            save(loaded, vm);
        } else {
            loaded.kind = lookUp(loaded.handle, vm, loaded.registrations);
        }
        return loaded;
    }

    // Releases the modules a destroyed VM owned so another VM can claim them. Does not wait for a load in progress.
    void vmDestroyed(JSC::VMIdentifier identifier)
    {
        WTF::Locker locker { m_ownersLock };
        m_owners.removeIf([&](auto& entry) {
            return entry.value == identifier;
        });
    }

private:
    DLHandleMap() = default;
    ~DLHandleMap() = default;

    DLHandleMap(const DLHandleMap&) = delete;
    DLHandleMap& operator=(const DLHandleMap&) = delete;

    static bool bindsToVM(const WTF::Vector<DLModuleRegistration>& registrations)
    {
        for (auto& registration : registrations) {
            auto* v8Module = std::get_if<V8ModuleRegistration>(&registration);
            if (v8Module && V8ModuleRegistration::bindsToVM(*v8Module->module))
                return true;
        }
        return false;
    }

    // `vm` is about to run the init functions.
    void save(const Loaded& loaded, JSC::VM& vm)
    {
        WTF::Vector<DLModuleRegistration> registrations;
        registrations.reserveInitialCapacity(loaded.napiModules.size() + loaded.v8Modules.size());
        for (auto& module : loaded.napiModules)
            registrations.append(DLModuleRegistration(new napi_module(module)));
        for (auto* module : loaded.v8Modules)
            registrations.append(DLModuleRegistration(V8ModuleRegistration { module }));

        if (bindsToVM(registrations)) {
            WTF::Locker ownersLocker { m_ownersLock };
            m_owners.set(loaded.handle, vm.identifier());
        }
        // The constructors ran, so an entry that is already here is from a library that was unloaded since.
        m_map.set(loaded.handle, WTF::move(registrations));
    }

    // Copies the saved registrations to `registrations` and makes `vm` the owner of the bindsToVM() ones, unless another live VM owns them.
    Loaded::Kind lookUp(DLHandle handle, JSC::VM& vm, WTF::Vector<DLModuleRegistration>& registrations)
    {
        auto it = m_map.find(handle);
        if (it == m_map.end())
            return Loaded::Kind::Unregistered;

        if (bindsToVM(it->value)) {
            auto identifier = vm.identifier();
            WTF::Locker ownersLocker { m_ownersLock };
            if (m_owners.add(handle, identifier).iterator->value != identifier)
                return Loaded::Kind::OwnedByAnotherVM;
        }

        registrations = it->value;
        return Loaded::Kind::Replay;
    }

    // Held across the OS loader call, so only load() takes it. It guards m_map.
    WTF::RecursiveLock m_lock;
    WTF::HashMap<DLHandle, WTF::Vector<DLModuleRegistration>> m_map;

    // The live VM that last ran the init of a library's bindsToVM() modules. Taken inside m_lock, never the other way around.
    WTF::Lock m_ownersLock;
    WTF::HashMap<DLHandle, JSC::VMIdentifier> m_owners WTF_GUARDED_BY_LOCK(m_ownersLock);
};

} // namespace Bun
