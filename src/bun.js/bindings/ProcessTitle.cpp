// Sets the OS-visible process title.
// On macOS, uses LaunchServices via dlopen (no link-time dependency on ObjC).
// On Linux, uses prctl(PR_SET_NAME).
// Ported from libuv's darwin-proctitle.c.

#include "root.h"

#if OS(DARWIN)

#include <dlfcn.h>
#include <pthread.h>
#include <string.h>

// Minimal CoreFoundation type stubs — we dlopen everything at runtime.
typedef const void* CFTypeRef;
typedef const void* CFStringRef;
typedef const void* CFAllocatorRef;
typedef const void* CFBundleRef;
typedef const void* CFDictionaryRef;
typedef const void* CFArrayRef;
typedef unsigned int CFStringEncoding;
typedef long CFIndex;
typedef int OSStatus;
static constexpr CFStringEncoding kCFStringEncodingUTF8 = 0x08000100;
static constexpr OSStatus noErr = 0;

extern "C" int Bun__setProcessTitle(const char* title)
{
    // Function pointers loaded via dlopen.
    CFStringRef (*pCFStringCreateWithCString)(CFAllocatorRef, const char*, CFStringEncoding);
    void (*pCFRelease)(CFTypeRef);
    CFBundleRef (*pCFBundleGetBundleWithIdentifier)(CFStringRef);
    void* (*pCFBundleGetDataPointerForName)(CFBundleRef, CFStringRef);
    void* (*pCFBundleGetFunctionPointerForName)(CFBundleRef, CFStringRef);
    CFTypeRef (*pLSGetCurrentApplicationASN)(void);
    OSStatus (*pLSSetApplicationInformationItem)(int, CFTypeRef, CFStringRef, CFStringRef, CFDictionaryRef*);
    CFDictionaryRef (*pCFBundleGetInfoDictionary)(CFBundleRef);
    CFBundleRef (*pCFBundleGetMainBundle)(void);
    CFDictionaryRef (*pLSApplicationCheckIn)(int, CFDictionaryRef);
    void (*pLSSetApplicationLaunchServicesServerConnectionStatus)(uint64_t, void*);

    void* application_services_handle;
    void* core_foundation_handle;
    CFBundleRef launch_services_bundle;
    CFStringRef* display_name_key;
    CFTypeRef asn;
    int err;

    // Track created CFStringRef objects for cleanup.
    CFStringRef cfLaunchServicesId = NULL;
    CFStringRef cfGetASN = NULL;
    CFStringRef cfSetInfo = NULL;
    CFStringRef cfDisplayNameKey = NULL;
    CFStringRef cfCheckIn = NULL;
    CFStringRef cfSetConnStatus = NULL;
    CFStringRef cfTitle = NULL;

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

#define S(s) pCFStringCreateWithCString(NULL, (s), kCFStringEncodingUTF8)

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
    display_name_key = (CFStringRef*)pCFBundleGetDataPointerForName(
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
        != noErr) {
        goto out;
    }

    // Also set the pthread name (shows in debuggers, limited to 64 chars).
    pthread_setname_np(title);
    err = 0;

#undef S

out:
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
