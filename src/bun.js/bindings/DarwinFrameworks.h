// Shared helpers for accessing macOS frameworks (CoreFoundation, LaunchServices)
// via dlopen at runtime, avoiding link-time ObjC dependencies.
// Used by ProcessTitle.cpp and future features like Bun.color.scheme.

#pragma once

#include "root.h"

#if OS(DARWIN)

#include <cstdint>

// All CF types are opaque void* to avoid pulling in CF headers.
static constexpr unsigned int kCFStringEncodingUTF8_ = 0x08000100;

// Lazy-initialized singleton that caches dlopen handles and function pointers
// for CoreFoundation and ApplicationServices frameworks.
struct DarwinFrameworks {
    // Framework handles
    void* coreFoundation;
    void* applicationServices;

    // CoreFoundation function pointers
    void* (*CFStringCreateWithCString)(void* alloc, const char* str, unsigned int encoding);
    void (*CFRelease)(void* cf);
    void* (*CFBundleGetBundleWithIdentifier)(void* bundleID);
    void* (*CFBundleGetDataPointerForName)(void* bundle, void* symbolName);
    void* (*CFBundleGetFunctionPointerForName)(void* bundle, void* symbolName);
    void* (*CFBundleGetInfoDictionary)(void* bundle);
    void* (*CFBundleGetMainBundle)(void);

    // Returns the lazily-initialized singleton, or nullptr if dlopen failed.
    static DarwinFrameworks* get();

    // Convenience: create a CFString from a C string (UTF-8). Caller must CFRelease.
    void* createCFString(const char* s) const
    {
        return CFStringCreateWithCString(nullptr, s, kCFStringEncodingUTF8_);
    }

    // Convenience: safe release that checks for null.
    void releaseCF(void* cf) const
    {
        if (cf)
            CFRelease(cf);
    }
};

#endif // OS(DARWIN)
