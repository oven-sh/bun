#include "root.h"

#if OS(WINDOWS)

#include <windows.h>
#include <delayimp.h>

// bun.exe delay-loads a set of Windows system DLLs (the /delayload list in
// scripts/build/flags.ts). The default delay-load helper in delayimp.lib
// resolves each one at first use with LoadLibraryExA(name, NULL, 0), which
// searches the application directory (and, for names outside KnownDlls, the
// CWD and PATH) before System32. Every name on that list is a Windows system
// DLL that only legitimately lives in System32, so a same-named DLL planted
// next to bun.exe would be loaded in its place.
//
// dliNotePreLoadLibrary lets this hook perform the load itself; the helper
// uses the returned module instead of searching. Restricting that one load to
// System32 closes the gap without touching the process-wide DLL search path,
// so process.dlopen() of .node addons (and their sibling-directory
// dependencies), bun:ffi dlopen(), bun:sqlite loadExtension(), and every
// other LoadLibrary in the process resolve exactly as they do under node.exe.
//
// The delay-loaded names are guaranteed to exist in System32, so the
// restricted load cannot fail on a functioning Windows install. If it ever
// does, returning NULL lets the helper run its stock LoadLibraryExA, whose
// own failure raises the usual delay-load exception.
//
// The matching restriction for bun.exe's static import table is
// /DEPENDENTLOADFLAG:0x800 in scripts/build/flags.ts.
static FARPROC WINAPI bunDelayLoadNotifyHook(unsigned dliNotify, PDelayLoadInfo pdli)
{
    if (dliNotify == dliNotePreLoadLibrary)
        return reinterpret_cast<FARPROC>(::LoadLibraryExA(pdli->szDll, nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32));
    return nullptr;
}

// delayimp.lib declares this `extern "C" const` pointer and holds a default
// NULL definition in a lazily pulled archive member. Defining it here, in an
// object that is always part of the link, satisfies the reference first, so
// __delayLoadHelper2 calls the hook above for every delay-loaded import.
extern "C" const PfnDliHook __pfnDliNotifyHook2 = bunDelayLoadNotifyHook;

#endif // OS(WINDOWS)
