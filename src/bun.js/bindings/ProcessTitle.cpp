// Sets the OS-visible process title.
// On macOS, uses LaunchServices via dlopen (no link-time dependency on ObjC).
// On Linux, uses prctl(PR_SET_NAME).
// Ported from libuv's darwin-proctitle.c.

#include "root.h"

#if OS(DARWIN)

#include <dlfcn.h>
#include <pthread.h>
#include <string.h>

// We dlopen CoreFoundation at runtime to avoid link-time ObjC dependency.
// Use void* for all CF types to avoid conflicting with system typedefs.
static constexpr unsigned int kCFStringEncodingUTF8_ = 0x08000100;

extern "C" int Bun__setProcessTitle(const char* title)
{
    // Function pointers loaded via dlopen.
    void* (*pCFStringCreateWithCString)(void*, const char*, unsigned int);
    void (*pCFRelease)(void*);
    void* (*pCFBundleGetBundleWithIdentifier)(void*);
    void* (*pCFBundleGetDataPointerForName)(void*, void*);
    void* (*pCFBundleGetFunctionPointerForName)(void*, void*);
    void* (*pLSGetCurrentApplicationASN)(void);
    int (*pLSSetApplicationInformationItem)(int, void*, void*, void*, void**);
    void* (*pCFBundleGetInfoDictionary)(void*);
    void* (*pCFBundleGetMainBundle)(void);
    void* (*pLSApplicationCheckIn)(int, void*);
    void (*pLSSetApplicationLaunchServicesServerConnectionStatus)(uint64_t, void*);

    void* application_services_handle;
    void* core_foundation_handle;
    void* launch_services_bundle;
    void** display_name_key;
    void* asn;
    int err;

    // Track created CF objects for cleanup.
    void* cfLaunchServicesId = NULL;
    void* cfGetASN = NULL;
    void* cfSetInfo = NULL;
    void* cfDisplayNameKey = NULL;
    void* cfCheckIn = NULL;
    void* cfSetConnStatus = NULL;
    void* cfTitle = NULL;

    err = -1;
    application_services_handle = dlopen(
        "/System/Library/Frameworks/ApplicationServices.framework/"
        "Versions/A/ApplicationServices",
        RTLD_LAZY | RTLD_LOCAL);
    core_foundation_handle = dlopen(
        "/System/Library/Frameworks/CoreFoundation.framework/"
        "Versions/A/CoreFoundation",
        RTLD_LAZY | RTLD_LOCAL);

    if (application_services_handle == NULL || core_foundation_handle == NULL)
        goto out;

    *(void**)(&pCFStringCreateWithCString) = dlsym(core_foundation_handle, "CFStringCreateWithCString");
    *(void**)(&pCFRelease) = dlsym(core_foundation_handle, "CFRelease");
    *(void**)(&pCFBundleGetBundleWithIdentifier) = dlsym(core_foundation_handle, "CFBundleGetBundleWithIdentifier");
    *(void**)(&pCFBundleGetDataPointerForName) = dlsym(core_foundation_handle, "CFBundleGetDataPointerForName");
    *(void**)(&pCFBundleGetFunctionPointerForName) = dlsym(core_foundation_handle, "CFBundleGetFunctionPointerForName");

    if (pCFStringCreateWithCString == NULL
        || pCFRelease == NULL
        || pCFBundleGetBundleWithIdentifier == NULL
        || pCFBundleGetDataPointerForName == NULL
        || pCFBundleGetFunctionPointerForName == NULL) {
        goto out;
    }

#define S(s) pCFStringCreateWithCString(NULL, (s), kCFStringEncodingUTF8_)

    cfLaunchServicesId = S("com.apple.LaunchServices");
    launch_services_bundle = pCFBundleGetBundleWithIdentifier(cfLaunchServicesId);

    if (launch_services_bundle == NULL)
        goto out;

    cfGetASN = S("_LSGetCurrentApplicationASN");
    *(void**)(&pLSGetCurrentApplicationASN) = pCFBundleGetFunctionPointerForName(
        launch_services_bundle, cfGetASN);

    if (pLSGetCurrentApplicationASN == NULL)
        goto out;

    cfSetInfo = S("_LSSetApplicationInformationItem");
    *(void**)(&pLSSetApplicationInformationItem) = pCFBundleGetFunctionPointerForName(
        launch_services_bundle, cfSetInfo);

    if (pLSSetApplicationInformationItem == NULL)
        goto out;

    cfDisplayNameKey = S("_kLSDisplayNameKey");
    display_name_key = (void**)pCFBundleGetDataPointerForName(
        launch_services_bundle, cfDisplayNameKey);

    if (display_name_key == NULL || *display_name_key == NULL)
        goto out;

    *(void**)(&pCFBundleGetInfoDictionary) = dlsym(core_foundation_handle, "CFBundleGetInfoDictionary");
    *(void**)(&pCFBundleGetMainBundle) = dlsym(core_foundation_handle, "CFBundleGetMainBundle");

    if (pCFBundleGetInfoDictionary == NULL || pCFBundleGetMainBundle == NULL)
        goto out;

    cfCheckIn = S("_LSApplicationCheckIn");
    *(void**)(&pLSApplicationCheckIn) = pCFBundleGetFunctionPointerForName(
        launch_services_bundle, cfCheckIn);

    if (pLSApplicationCheckIn == NULL)
        goto out;

    cfSetConnStatus = S("_LSSetApplicationLaunchServicesServerConnectionStatus");
    *(void**)(&pLSSetApplicationLaunchServicesServerConnectionStatus) = pCFBundleGetFunctionPointerForName(
        launch_services_bundle, cfSetConnStatus);

    if (pLSSetApplicationLaunchServicesServerConnectionStatus == NULL)
        goto out;

    pLSSetApplicationLaunchServicesServerConnectionStatus(0, NULL);

    // Check into LaunchServices process manager.
    pLSApplicationCheckIn(-2,
        pCFBundleGetInfoDictionary(pCFBundleGetMainBundle()));

    asn = pLSGetCurrentApplicationASN();

    if (asn == NULL)
        goto out;

    cfTitle = S(title);
    if (pLSSetApplicationInformationItem(-2, asn, *display_name_key,
            cfTitle, NULL)
        != 0) {
        goto out;
    }

    err = 0;

#undef S

out:
    // Always set the pthread name regardless of LaunchServices success.
    // pthread_setname_np works independently and is useful on headless macOS
    // (CI, SSH, Docker) where LaunchServices is unavailable.
    pthread_setname_np(title);
    if (pCFRelease != NULL) {
        if (cfLaunchServicesId != NULL)
            pCFRelease(cfLaunchServicesId);
        if (cfGetASN != NULL)
            pCFRelease(cfGetASN);
        if (cfSetInfo != NULL)
            pCFRelease(cfSetInfo);
        if (cfDisplayNameKey != NULL)
            pCFRelease(cfDisplayNameKey);
        if (cfCheckIn != NULL)
            pCFRelease(cfCheckIn);
        if (cfSetConnStatus != NULL)
            pCFRelease(cfSetConnStatus);
        if (cfTitle != NULL)
            pCFRelease(cfTitle);
    }

    if (core_foundation_handle != NULL)
        dlclose(core_foundation_handle);
    if (application_services_handle != NULL)
        dlclose(application_services_handle);

    return err;
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

// On Windows, process.title is handled by libuv via uv_set_process_title.
extern "C" int Bun__setProcessTitle(const char*)
{
    return 0;
}

#else

extern "C" int Bun__setProcessTitle(const char*)
{
    return -1;
}

#endif
