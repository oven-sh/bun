#pragma once

#include "root.h"
#include "v8/node.h"
#include "napi.h"
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

// A module can be either V8 C++ style or NAPI style
using DLModuleRegistration = std::variant<node::node_module*, napi_module*>;

// Thread-safe map for tracking dlopen handles to module registrations.
// This allows re-loading the same native module multiple times, matching Node.js behavior.
//
// A single .node file can register multiple modules (both NAPI and V8 C++), so we store
// a vector of registrations per handle. When a native module is loaded for the first time,
// its static constructors run and call node_module_register() or napi_module_register().
// On subsequent loads, dlopen() returns the same handle but the constructors don't run again.
// We use this map to look up and replay all saved registrations.
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

    // Add a V8 C++ module registration to the vector for this handle
    void add(DLHandle handle, node::node_module* module)
    {
        ASSERT(handle != nullptr);
        ASSERT(module != nullptr);

        WTF::Locker locker { m_lock };
        auto& registrations = m_map.ensure(handle, [] { return WTF::Vector<DLModuleRegistration>(); }).iterator->value;
        registrations.append(DLModuleRegistration(module));
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

private:
    DLHandleMap() = default;
    ~DLHandleMap() = default;

    DLHandleMap(const DLHandleMap&) = delete;
    DLHandleMap& operator=(const DLHandleMap&) = delete;

    WTF::Lock m_lock;
    WTF::HashMap<DLHandle, WTF::Vector<DLModuleRegistration>> m_map;
};

} // namespace Bun
