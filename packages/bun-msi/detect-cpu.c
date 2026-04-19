// Immediate CustomAction that picks which bun.exe variant to install.
//
// Sets the public property BUNVARIANT to one of:
//   "arm64"         native ARM64 host
//   "x64"           AMD64 host with AVX2
//   "x64-baseline"  AMD64 host without AVX2
//
// Mirrors the detection in src/cli/install.ps1 (PROCESSOR_ARCHITECTURE from
// the registry + IsProcessorFeaturePresent(40)), but uses IsWow64Process2 so
// the answer is correct even when the x64 MSI is running under emulation on
// an ARM64 host — we want the *native* machine, not the process machine.
//
// Shipped as a native DLL rather than a script CA because Windows
// Installer's script hosts (VBScript/JScript) are optional components on
// Win11 24H2+ and are routinely GPO-blocked on enterprise fleets, and
// launching powershell.exe as a type-50 CA can't set MSI properties
// in-process. A DLL CA is the portable option.
//
// Compiled at MSI build time by packages/bun-msi/build-msi.ps1 using the
// MSVC toolchain on the windows-latest runner, so there's no separate
// binary artifact checked into git or carried through CI.

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <msi.h>
#include <msiquery.h>

#ifndef PF_AVX2_INSTRUCTIONS_AVAILABLE
#define PF_AVX2_INSTRUCTIONS_AVAILABLE 40
#endif

// IsWow64Process2 landed in Windows 10 1709 (build 16299); our install
// floor is 1809, so kernel32 always exports it on any OS the installer
// is allowed to run on. That ordering (floor > availability) is what
// makes link-time resolution safe here — not the LaunchConditions gate:
// this CA is sequenced After=AppSearch, which runs *before*
// LaunchConditions, so on a hypothetical pre-1709 box the DLL load would
// fail with 1720/1723 before the friendly min-OS message ever appeared.
extern BOOL WINAPI IsWow64Process2(HANDLE, USHORT*, USHORT*);

__declspec(dllexport) UINT __stdcall DetectCpu(MSIHANDLE install)
{
    // Respect an explicit override (msiexec ... BUNVARIANT=x64-baseline).
    // The CA is also sequenced with Condition="NOT BUNVARIANT" so this is
    // belt-and-suspenders, but it keeps the DLL self-contained if someone
    // re-sequences it.
    WCHAR existing[32];
    DWORD n = (DWORD)(sizeof(existing) / sizeof(existing[0]));
    if (MsiGetPropertyW(install, L"BUNVARIANT", existing, &n) == ERROR_SUCCESS && n > 0) {
        return ERROR_SUCCESS;
    }

    const WCHAR* variant = L"x64-baseline"; // safest default: runs everywhere

    USHORT process = 0, native = 0;
    if (IsWow64Process2(GetCurrentProcess(), &process, &native) && native == IMAGE_FILE_MACHINE_ARM64) {
        variant = L"arm64";
    } else if (IsProcessorFeaturePresent(PF_AVX2_INSTRUCTIONS_AVAILABLE)) {
        variant = L"x64";
    }

    MsiSetPropertyW(install, L"BUNVARIANT", variant);
    return ERROR_SUCCESS;
}
