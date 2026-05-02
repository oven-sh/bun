// Lazy-initialized access to macOS CoreFoundation and ApplicationServices
// frameworks via dlopen. See DarwinFrameworks.h for usage.

#include "DarwinFrameworks.h"

#if OS(DARWIN)

#include <dlfcn.h>

DarwinFrameworks* DarwinFrameworks::get()
{
    static DarwinFrameworks* instance = []() -> DarwinFrameworks* {
        void* cf = dlopen(
            "/System/Library/Frameworks/CoreFoundation.framework/"
            "Versions/A/CoreFoundation",
            RTLD_LAZY | RTLD_LOCAL);

        void* as = dlopen(
            "/System/Library/Frameworks/ApplicationServices.framework/"
            "Versions/A/ApplicationServices",
            RTLD_LAZY | RTLD_LOCAL);

        if (!cf || !as) {
            if (cf)
                dlclose(cf);
            if (as)
                dlclose(as);
            return nullptr;
        }

        // Resolve CoreFoundation symbols.
        auto pCFStringCreateWithCString = reinterpret_cast<decltype(DarwinFrameworks::CFStringCreateWithCString)>(dlsym(cf, "CFStringCreateWithCString"));
        auto pCFRelease = reinterpret_cast<decltype(DarwinFrameworks::CFRelease)>(dlsym(cf, "CFRelease"));
        auto pCFBundleGetBundleWithIdentifier = reinterpret_cast<decltype(DarwinFrameworks::CFBundleGetBundleWithIdentifier)>(dlsym(cf, "CFBundleGetBundleWithIdentifier"));
        auto pCFBundleGetDataPointerForName = reinterpret_cast<decltype(DarwinFrameworks::CFBundleGetDataPointerForName)>(dlsym(cf, "CFBundleGetDataPointerForName"));
        auto pCFBundleGetFunctionPointerForName = reinterpret_cast<decltype(DarwinFrameworks::CFBundleGetFunctionPointerForName)>(dlsym(cf, "CFBundleGetFunctionPointerForName"));
        auto pCFBundleGetInfoDictionary = reinterpret_cast<decltype(DarwinFrameworks::CFBundleGetInfoDictionary)>(dlsym(cf, "CFBundleGetInfoDictionary"));
        auto pCFBundleGetMainBundle = reinterpret_cast<decltype(DarwinFrameworks::CFBundleGetMainBundle)>(dlsym(cf, "CFBundleGetMainBundle"));

        if (!pCFStringCreateWithCString
            || !pCFRelease
            || !pCFBundleGetBundleWithIdentifier
            || !pCFBundleGetDataPointerForName
            || !pCFBundleGetFunctionPointerForName
            || !pCFBundleGetInfoDictionary
            || !pCFBundleGetMainBundle) {
            dlclose(cf);
            dlclose(as);
            return nullptr;
        }

        // Intentionally leaked — these handles live for the process lifetime.
        static DarwinFrameworks frameworks;
        frameworks.coreFoundation = cf;
        frameworks.applicationServices = as;
        frameworks.CFStringCreateWithCString = pCFStringCreateWithCString;
        frameworks.CFRelease = pCFRelease;
        frameworks.CFBundleGetBundleWithIdentifier = pCFBundleGetBundleWithIdentifier;
        frameworks.CFBundleGetDataPointerForName = pCFBundleGetDataPointerForName;
        frameworks.CFBundleGetFunctionPointerForName = pCFBundleGetFunctionPointerForName;
        frameworks.CFBundleGetInfoDictionary = pCFBundleGetInfoDictionary;
        frameworks.CFBundleGetMainBundle = pCFBundleGetMainBundle;
        return &frameworks;
    }();

    return instance;
}

#endif // OS(DARWIN)
