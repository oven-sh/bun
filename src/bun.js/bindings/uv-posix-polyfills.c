#include "uv-posix-polyfills.h"

#if OS(LINUX) || OS(DARWIN)

#include <dlfcn.h>
#include <pthread.h>
#include <unistd.h>
#include <stdlib.h>

// libuv does the annoying thing of #undef'ing these
#include <errno.h>
#if EDOM > 0
#define UV__ERR(x) (-(x))
#else
#define UV__ERR(x) (x)
#endif

void __bun_throw_not_implemented(const char* symbol_name)
{
    CrashHandler__unsupportedUVFunction(symbol_name);
}

// Internals

uint64_t uv__hrtime(uv_clocktype_t type);

#if defined(__linux__)
#include <sys/prctl.h>
#include "uv-posix-polyfills-linux.c"
// #elif defined(__MVS__)
// #include "uv/os390.h"
// #elif defined(__PASE__) /* __PASE__ and _AIX are both defined on IBM i */
// #include "uv/posix.h" /* IBM i needs uv/posix.h, not uv/aix.h */
// #elif defined(_AIX)
// #include "uv/aix.h"
// #elif defined(__sun)
// #include "uv/sunos.h"
#elif defined(__APPLE__)
#include <CoreFoundation/CoreFoundation.h>
#include <CoreServices/CoreServices.h>
#include "uv-posix-polyfills-darwin.c"
// #elif defined(__DragonFly__) || defined(__FreeBSD__) || defined(__OpenBSD__) || defined(__NetBSD__)
// #include "uv/bsd.h"
#elif defined(__CYGWIN__) || defined(__MSYS__) || defined(__HAIKU__) || defined(__QNX__) || defined(__GNU__)
#include "uv-posix-polyfills-posix.c"
#endif

uv_pid_t uv_os_getpid()
{
    return getpid();
}

uv_pid_t uv_os_getppid()
{
    return getppid();
}

UV_EXTERN void uv_once(uv_once_t* guard, void (*callback)(void))
{
    if (pthread_once(guard, callback))
        abort();
}

UV_EXTERN uint64_t uv_hrtime(void)
{
    return uv__hrtime(UV_CLOCK_PRECISE);
}

// Copy-pasted from libuv
UV_EXTERN void uv_mutex_destroy(uv_mutex_t* mutex)
{
    if (pthread_mutex_destroy(mutex))
        abort();
}

// Copy-pasted from libuv
UV_EXTERN int uv_mutex_init(uv_mutex_t* mutex)
{
    pthread_mutexattr_t attr;
    int err;

    if (pthread_mutexattr_init(&attr))
        abort();

    if (pthread_mutexattr_settype(&attr, PTHREAD_MUTEX_ERRORCHECK))
        abort();

    err = pthread_mutex_init(mutex, &attr);

    if (pthread_mutexattr_destroy(&attr))
        abort();

    return UV__ERR(err);
}

// Copy-pasted from libuv
UV_EXTERN int uv_mutex_init_recursive(uv_mutex_t* mutex)
{
    pthread_mutexattr_t attr;
    int err;

    if (pthread_mutexattr_init(&attr))
        abort();

    if (pthread_mutexattr_settype(&attr, PTHREAD_MUTEX_RECURSIVE))
        abort();

    err = pthread_mutex_init(mutex, &attr);

    if (pthread_mutexattr_destroy(&attr))
        abort();

    return UV__ERR(err);
}

// Copy-pasted from libuv
UV_EXTERN void uv_mutex_lock(uv_mutex_t* mutex)
{
    if (pthread_mutex_lock(mutex))
        abort();
}

// Copy-pasted from libuv
UV_EXTERN int uv_mutex_trylock(uv_mutex_t* mutex)
{
    int err;

    err = pthread_mutex_trylock(mutex);
    if (err) {
        if (err != EBUSY && err != EAGAIN)
            abort();
        return UV_EBUSY;
    }

    return 0;
}

// Copy-pasted from libuv
UV_EXTERN void uv_mutex_unlock(uv_mutex_t* mutex)
{
    if (pthread_mutex_unlock(mutex))
        abort();
}

#if defined(__APPLE__)
#include <dispatch/dispatch.h>
typedef OSStatus (*LSSetApplicationInformationItemPtr)(int, void*, CFStringRef, CFStringRef, void*);
#endif

UV_EXTERN int uv_set_process_title(const char* title)
{
#if defined(__APPLE__)
    // pthread_setname_np limits to 63 characters
    int err = pthread_setname_np(title);

    // This is based on Libuv's implementation
    // https://github.com/libuv/libuv/blob/v1.x/src/unix/darwin-proctitle.c
    typedef CFTypeRef (*LSGetCurrentApplicationASNType)(void);
    typedef OSStatus (*LSSetApplicationInformationItemType)(int, CFTypeRef, CFStringRef, CFStringRef, CFDictionaryRef*);
    typedef void* (*LSSetApplicationLaunchServicesServerConnectionStatusType)(uint64_t, void*);
    typedef CFDictionaryRef (*LSApplicationCheckInType)(int, CFDictionaryRef);
    typedef CFDictionaryRef (*CFBundleGetInfoDictionaryType)(CFBundleRef);
    typedef CFBundleRef (*CFBundleGetMainBundleType)(void);

    static LSGetCurrentApplicationASNType pLSGetCurrentApplicationASN = NULL;
    static LSSetApplicationInformationItemType pLSSetApplicationInformationItem = NULL;
    static LSSetApplicationLaunchServicesServerConnectionStatusType pLSSetApplicationLaunchServicesServerConnectionStatus = NULL;
    static LSApplicationCheckInType pLSApplicationCheckIn = NULL;
    static CFBundleGetInfoDictionaryType pCFBundleGetInfoDictionary = NULL;
    static CFBundleGetMainBundleType pCFBundleGetMainBundle = NULL;
    static CFStringRef* p_kLSDisplayNameKey = NULL;

    static void* application_services_handle = NULL;
    static void* core_foundation_handle = NULL;

    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        application_services_handle = dlopen("/System/Library/Frameworks/ApplicationServices.framework/Versions/A/ApplicationServices", RTLD_LAZY | RTLD_LOCAL);
        core_foundation_handle = dlopen("/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation", RTLD_LAZY | RTLD_LOCAL);

        if (application_services_handle == NULL || core_foundation_handle == NULL) {
            goto cleanup;
        }

        CFBundleRef (*pCFBundleGetBundleWithIdentifier)(CFStringRef) = (CFBundleRef (*)(CFStringRef))dlsym(core_foundation_handle, "CFBundleGetBundleWithIdentifier");
        void* (*pCFBundleGetDataPointerForName)(CFBundleRef, CFStringRef) = (void* (*)(CFBundleRef, CFStringRef))dlsym(core_foundation_handle, "CFBundleGetDataPointerForName");
        void* (*pCFBundleGetFunctionPointerForName)(CFBundleRef, CFStringRef) = (void* (*)(CFBundleRef, CFStringRef))dlsym(core_foundation_handle, "CFBundleGetFunctionPointerForName");
        CFStringRef (*pCFStringCreateWithCString)(CFAllocatorRef, const char*, CFStringEncoding) = (CFStringRef (*)(CFAllocatorRef, const char*, CFStringEncoding))dlsym(core_foundation_handle, "CFStringCreateWithCString");

        if (pCFBundleGetBundleWithIdentifier == NULL || pCFBundleGetDataPointerForName == NULL || pCFBundleGetFunctionPointerForName == NULL || pCFStringCreateWithCString == NULL) {
             goto cleanup;
        }

        CFStringRef bundleName = pCFStringCreateWithCString(NULL, "com.apple.LaunchServices", kCFStringEncodingUTF8);
        CFBundleRef launch_services_bundle = pCFBundleGetBundleWithIdentifier(bundleName);
        CFRelease(bundleName);
        
        if (launch_services_bundle == NULL) {
            goto cleanup;
        }

        CFStringRef asnName = pCFStringCreateWithCString(NULL, "_LSGetCurrentApplicationASN", kCFStringEncodingUTF8);
        pLSGetCurrentApplicationASN = (LSGetCurrentApplicationASNType)pCFBundleGetFunctionPointerForName(launch_services_bundle, asnName);
        CFRelease(asnName);
        if (pLSGetCurrentApplicationASN == NULL) goto cleanup;

        CFStringRef setInfoName = pCFStringCreateWithCString(NULL, "_LSSetApplicationInformationItem", kCFStringEncodingUTF8);
        pLSSetApplicationInformationItem = (LSSetApplicationInformationItemType)pCFBundleGetFunctionPointerForName(launch_services_bundle, setInfoName);
        CFRelease(setInfoName);
        if (pLSSetApplicationInformationItem == NULL) goto cleanup;

        CFStringRef connectionStatusName = pCFStringCreateWithCString(NULL, "_LSSetApplicationLaunchServicesServerConnectionStatus", kCFStringEncodingUTF8);
        pLSSetApplicationLaunchServicesServerConnectionStatus = (LSSetApplicationLaunchServicesServerConnectionStatusType)pCFBundleGetFunctionPointerForName(launch_services_bundle, connectionStatusName);
        CFRelease(connectionStatusName);
        if (pLSSetApplicationLaunchServicesServerConnectionStatus == NULL) goto cleanup;

        CFStringRef checkInName = pCFStringCreateWithCString(NULL, "_LSApplicationCheckIn", kCFStringEncodingUTF8);
        pLSApplicationCheckIn = (LSApplicationCheckInType)pCFBundleGetFunctionPointerForName(launch_services_bundle, checkInName);
        CFRelease(checkInName);
        if (pLSApplicationCheckIn == NULL) goto cleanup;

        CFStringRef displayNameKeyName = pCFStringCreateWithCString(NULL, "_kLSDisplayNameKey", kCFStringEncodingUTF8);
        p_kLSDisplayNameKey = (CFStringRef*)pCFBundleGetDataPointerForName(launch_services_bundle, displayNameKeyName);
        CFRelease(displayNameKeyName);
        if (p_kLSDisplayNameKey == NULL || *p_kLSDisplayNameKey == NULL) goto cleanup;

        pCFBundleGetInfoDictionary = (CFBundleGetInfoDictionaryType)dlsym(core_foundation_handle, "CFBundleGetInfoDictionary");
        pCFBundleGetMainBundle = (CFBundleGetMainBundleType)dlsym(core_foundation_handle, "CFBundleGetMainBundle");

        if (pCFBundleGetInfoDictionary == NULL || pCFBundleGetMainBundle == NULL) goto cleanup;

        return;

    cleanup:
        if (application_services_handle) dlclose(application_services_handle);
        if (core_foundation_handle) dlclose(core_foundation_handle);
        application_services_handle = NULL;
        core_foundation_handle = NULL;
    });

    if (pLSSetApplicationInformationItem) {
        // Connect to LaunchServices
        pLSSetApplicationLaunchServicesServerConnectionStatus(0, NULL);
        
        // CheckIn
        pLSApplicationCheckIn(-2, pCFBundleGetInfoDictionary(pCFBundleGetMainBundle()));
        
        CFTypeRef asn = pLSGetCurrentApplicationASN();
        if (asn != NULL) {
            CFStringRef value = CFStringCreateWithCString(NULL, title, kCFStringEncodingUTF8);
            pLSSetApplicationInformationItem(-2, asn, *p_kLSDisplayNameKey, value, NULL);
            CFRelease(value);
        }
    }

    return err == 0 ? 0 : UV__ERR(err);
#elif defined(__linux__)
    return prctl(PR_SET_NAME, (unsigned long)title, 0, 0, 0) == 0 ? 0 : UV__ERR(errno);
#else
    __bun_throw_not_implemented("uv_set_process_title");
    __builtin_unreachable();
#endif
}

#endif
