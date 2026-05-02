// Sets the OS-visible process title.
// On macOS, uses LaunchServices via dlopen (no link-time dependency on ObjC).
// On Linux, uses prctl(PR_SET_NAME).
// Ported from libuv's darwin-proctitle.c.

#include "root.h"

#if OS(DARWIN)

#include "DarwinFrameworks.h"

extern "C" int Bun__setProcessTitle(const char* title)
{
    auto* fw = DarwinFrameworks::get();
    if (!fw)
        return -1;

    {
        void* launch_services_bundle;
        void** display_name_key;
        void* asn;
        int err = -1;

        // LaunchServices function pointers resolved from the bundle.
        void* (*pLSGetCurrentApplicationASN)(void) = nullptr;
        int (*pLSSetApplicationInformationItem)(int, void*, void*, void*, void**) = nullptr;
        void* (*pLSApplicationCheckIn)(int, void*) = nullptr;
        void (*pLSSetApplicationLaunchServicesServerConnectionStatus)(uint64_t, void*) = nullptr;

        // Track created CF objects for cleanup.
        void* cfLaunchServicesId = nullptr;
        void* cfGetASN = nullptr;
        void* cfSetInfo = nullptr;
        void* cfDisplayNameKey = nullptr;
        void* cfCheckIn = nullptr;
        void* cfSetConnStatus = nullptr;
        void* cfTitle = nullptr;

        cfLaunchServicesId = fw->createCFString("com.apple.LaunchServices");
        launch_services_bundle = fw->CFBundleGetBundleWithIdentifier(cfLaunchServicesId);

        if (!launch_services_bundle)
            goto out;

        cfGetASN = fw->createCFString("_LSGetCurrentApplicationASN");
        *(void**)(&pLSGetCurrentApplicationASN) = fw->CFBundleGetFunctionPointerForName(
            launch_services_bundle, cfGetASN);

        if (!pLSGetCurrentApplicationASN)
            goto out;

        cfSetInfo = fw->createCFString("_LSSetApplicationInformationItem");
        *(void**)(&pLSSetApplicationInformationItem) = fw->CFBundleGetFunctionPointerForName(
            launch_services_bundle, cfSetInfo);

        if (!pLSSetApplicationInformationItem)
            goto out;

        cfDisplayNameKey = fw->createCFString("_kLSDisplayNameKey");
        display_name_key = (void**)fw->CFBundleGetDataPointerForName(
            launch_services_bundle, cfDisplayNameKey);

        if (!display_name_key || !*display_name_key)
            goto out;

        cfCheckIn = fw->createCFString("_LSApplicationCheckIn");
        *(void**)(&pLSApplicationCheckIn) = fw->CFBundleGetFunctionPointerForName(
            launch_services_bundle, cfCheckIn);

        if (!pLSApplicationCheckIn)
            goto out;

        cfSetConnStatus = fw->createCFString("_LSSetApplicationLaunchServicesServerConnectionStatus");
        *(void**)(&pLSSetApplicationLaunchServicesServerConnectionStatus) = fw->CFBundleGetFunctionPointerForName(
            launch_services_bundle, cfSetConnStatus);

        if (!pLSSetApplicationLaunchServicesServerConnectionStatus)
            goto out;

        pLSSetApplicationLaunchServicesServerConnectionStatus(0, NULL);

        // Check into LaunchServices process manager.
        pLSApplicationCheckIn(-2,
            fw->CFBundleGetInfoDictionary(fw->CFBundleGetMainBundle()));

        asn = pLSGetCurrentApplicationASN();

        if (!asn)
            goto out;

        cfTitle = fw->createCFString(title);
        if (!cfTitle)
            goto out;

        if (pLSSetApplicationInformationItem(-2, asn, *display_name_key,
                cfTitle, NULL)
            != 0) {
            goto out;
        }

        err = 0;

    out:
        fw->releaseCF(cfLaunchServicesId);
        fw->releaseCF(cfGetASN);
        fw->releaseCF(cfSetInfo);
        fw->releaseCF(cfDisplayNameKey);
        fw->releaseCF(cfCheckIn);
        fw->releaseCF(cfSetConnStatus);
        fw->releaseCF(cfTitle);

        return err;
    }
}

#elif OS(LINUX)

#include <sys/prctl.h>
#include <string.h>

extern "C" int Bun__setProcessTitle(const char* title)
{
    // prctl(PR_SET_NAME) only copies the first 16 characters.
    prctl(PR_SET_NAME, title);
    return 0;
}

#elif OS(WINDOWS)

#include <uv.h>

extern "C" int Bun__setProcessTitle(const char* title)
{
    return uv_set_process_title(title);
}

#else

extern "C" int Bun__setProcessTitle(const char*)
{
    return -1;
}

#endif
