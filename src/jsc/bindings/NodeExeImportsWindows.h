#pragma once

#include "root.h"

#if OS(WINDOWS)

#include <windows.h>
#include <wtf/text/WTFString.h>

namespace Bun {

// Native addons are linked against node.lib, so their N-API imports name the module "node.exe".
// Inside node that is the running executable. Inside bun, an addon built without node-gyp's
// win_delay_load_hook makes the loader (regular import) or delayimp (delay-load import) go find a
// real node.exe on the DLL search path and bind the addon's napi_* calls to it.
//
// NodeExeImports redirects those bindings to the running executable: while a Scope is alive on a
// thread, every module the loader maps on that thread has its regular `node.exe` import address
// table rewritten to this process's exports and its delay-load `node.exe` module handle preset to
// this process, after the loader snapped the module's imports and before its DllMain runs.
//
// https://github.com/oven-sh/bun/issues/10690
class NodeExeImports {
public:
    class ScopeAccess;
    class Scope {
    public:
        Scope();
        ~Scope();
        Scope(const Scope&) = delete;
        Scope& operator=(const Scope&) = delete;

        // After LoadLibraryExW returned `loaded` (null if it failed): a null String if every regular
        // node.exe import of every module loaded in this scope resolved against the host, otherwise
        // a message naming the module and symbol. On a message with a non-null `loaded` the caller
        // must FreeLibrary and fail the load: that slot is still bound to the real node.exe the
        // loader found. A `loaded` the notification did not see (already loaded before this scope,
        // or no notification available) is redirected here, once per module.
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

    // The caller unloads `module`: drop it from the once-per-module redirect set, since a later
    // module can be mapped at the same base address.
    static void forget(HMODULE module);

    // For a LoadLibraryExW that failed with ERROR_MOD_NOT_FOUND: whether the file has a load-time
    // (non-delay) import of node.exe, which the loader can only satisfy from a node.exe on the DLL
    // search path.
    static bool fileHasLoadTimeNodeExeImport(const wchar_t* path);
};

} // namespace Bun

#endif // OS(WINDOWS)
