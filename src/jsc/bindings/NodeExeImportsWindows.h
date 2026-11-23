#pragma once

#include "root.h"

#if OS(WINDOWS)

#include <windows.h>
#include <wtf/text/WTFString.h>

namespace Bun {

// Native addons link against node.lib, so they import N-API from a module called "node.exe". Without node-gyp's
// win_delay_load_hook, the loader (load-time import) or delayimp (delay-load import) finds a real node.exe on the DLL
// search path and binds the addon's napi_* calls to it.
//
// While a Scope is alive on a thread, every module the loader maps on that thread has its `node.exe` imports redirected
// to this executable. That happens after the loader snaps the module's imports and before its DllMain runs.
class NodeExeImports {
public:
    class ScopeAccess;
    class Scope {
    public:
        Scope();
        ~Scope();
        Scope(const Scope&) = delete;
        Scope& operator=(const Scope&) = delete;

        // Call after LoadLibraryExW returns `loaded` (null if it failed). Returns a null String if this executable exports
        // every load-time node.exe import of every module loaded in this scope. Otherwise returns a message with the module
        // and the symbol, and the caller must FreeLibrary `loaded` and fail the load because that slot is still bound to the
        // real node.exe. Also redirects `loaded` if there was no notification for it.
        WTF::String unresolvedImportError(HMODULE loaded);

    private:
        friend class NodeExeImports::ScopeAccess;
        Scope* m_previous;
        void* m_notified[32];
        size_t m_notifiedCount { 0 };
        bool m_failed { false };
        char m_symbol[192] { 0 };
        wchar_t m_module[64] { 0 };
    };

    // Call before unloading `module`, because a later module can be mapped at the same base address.
    static void forget(HMODULE module);
};

} // namespace Bun

#endif // OS(WINDOWS)
