/*
 * Copyright 2013 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef GrGLExtensions_DEFINED
#define GrGLExtensions_DEFINED

#include "include/core/SkString.h"
#include "include/gpu/gl/GrGLFunctions.h"
#include "include/private/SkTArray.h"

#include <utility>

struct GrGLInterface;
class SkJSONWriter;

/**
 * This helper queries the current GL context for its extensions, remembers them, and can be
 * queried. It supports both glGetString- and glGetStringi-style extension string APIs and will
 * use the latter if it is available. It also will query for EGL extensions if a eglQueryString
 * implementation is provided.
 */
class SK_API GrGLExtensions {
public:
    GrGLExtensions() {}

    GrGLExtensions(const GrGLExtensions&);

    GrGLExtensions& operator=(const GrGLExtensions&);

    void swap(GrGLExtensions* that) {
        using std::swap;
        swap(fStrings, that->fStrings);
        swap(fInitialized, that->fInitialized);
    }

    /**
     * We sometimes need to use this class without having yet created a GrGLInterface. This version
     * of init expects that getString is always non-NULL while getIntegerv and getStringi are non-
     * NULL if on desktop GL with version 3.0 or higher. Otherwise it will fail.
     */
    bool init(GrGLStandard standard,
              GrGLFunction<GrGLGetStringFn> getString,
              GrGLFunction<GrGLGetStringiFn> getStringi,
              GrGLFunction<GrGLGetIntegervFn> getIntegerv,
              GrGLFunction<GrEGLQueryStringFn> queryString = nullptr,
              GrEGLDisplay eglDisplay = nullptr);

    bool isInitialized() const { return fInitialized; }

    /**
     * Queries whether an extension is present. This will fail if init() has not been called.
     */
    bool has(const char[]) const;

    /**
     * Removes an extension if present. Returns true if the extension was present before the call.
     */
    bool remove(const char[]);

    /**
     * Adds an extension to list
     */
    void add(const char[]);

    void reset() { fStrings.reset(); }

    void dumpJSON(SkJSONWriter*) const;

private:
    bool fInitialized = false;
    SkTArray<SkString> fStrings;
};

#endif
