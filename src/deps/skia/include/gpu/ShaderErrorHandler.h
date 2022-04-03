/*
 * Copyright 2021 Google LLC
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef skgpu_ShaderErrorHandler_DEFINED
#define skgpu_ShaderErrorHandler_DEFINED

#include "include/core/SkTypes.h"

namespace skgpu {
/**
 * Abstract class to report errors when compiling shaders.
 */
class SK_API ShaderErrorHandler {
public:
    virtual ~ShaderErrorHandler() = default;

    virtual void compileError(const char* shader, const char* errors) = 0;

protected:
    ShaderErrorHandler() = default;
    ShaderErrorHandler(const ShaderErrorHandler&) = delete;
    ShaderErrorHandler& operator=(const ShaderErrorHandler&) = delete;
};

/**
 * Used when no error handler is set. Will report failures via SkDebugf and asserts.
 */
ShaderErrorHandler* DefaultShaderErrorHandler();

}  // namespace skgpu

#endif // skgpu_ShaderErrorHandler_DEFINED
