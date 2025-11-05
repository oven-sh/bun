#pragma once

#include "root.h"
#include "node.h"
#include "napi.h"
#include <wtf/HashMap.h>
#include <wtf/Lock.h>
#include <variant>

#if OS(WINDOWS)
#include <windows.h>
#endif

namespace Bun {

// Thread-safe map for tracking dlopen handles to module registrations.
// This allows re-loading the same native module multiple times, matching Node.js behavior.
//
// When a native module is loaded for the first time, its static constructor runs and
// calls node_module_register() or napi_module_register(). On subsequent loads, dlopen()
// returns the same handle but the constructor doesn't run again. We use this map to look
// up the saved registration and replay it.
class DLHandleMap {
public:
#if OS(WINDOWS)
    using DLHandle = HMODULE;
#else
    using DLHandle = void*;
#endif

    // A module can be either V8 C++ style or NAPI style
    using ModuleRegistration = std::variant<node::node_module*, napi_module*>;

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

    // Save a V8 C++ module registration
    void set(DLHandle handle, node::node_module* module)
    {
        ASSERT(handle != nullptr);
        ASSERT(module != nullptr);

        WTF::Locker locker { m_lock };
        m_map.set(handle, ModuleRegistration(module));
    }

    // Save a NAPI module registration
    void set(DLHandle handle, napi_module* module)
    {
        ASSERT(handle != nullptr);
        ASSERT(module != nullptr);

        WTF::Locker locker { m_lock };
        m_map.set(handle, ModuleRegistration(module));
    }

    // Look up a previously saved module registration
    std::optional<ModuleRegistration> get(DLHandle handle)
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
    WTF::HashMap<DLHandle, ModuleRegistration> m_map;
};

} // namespace Bun
