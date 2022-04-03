/*
 * Copyright 2017 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkPromiseImageTexture_DEFINED
#define SkPromiseImageTexture_DEFINED

#include "include/core/SkTypes.h"

#if SK_SUPPORT_GPU
#include "include/core/SkRefCnt.h"
#include "include/gpu/GrBackendSurface.h"
/**
 * This type is used to fulfill textures for PromiseImages. Once an instance is returned from a
 * PromiseImageTextureFulfillProc the GrBackendTexture it wraps must remain valid until the
 * corresponding PromiseImageTextureReleaseProc is called.
 */
class SK_API SkPromiseImageTexture : public SkNVRefCnt<SkPromiseImageTexture> {
public:
    SkPromiseImageTexture() = delete;
    SkPromiseImageTexture(const SkPromiseImageTexture&) = delete;
    SkPromiseImageTexture(SkPromiseImageTexture&&) = delete;
    ~SkPromiseImageTexture();
    SkPromiseImageTexture& operator=(const SkPromiseImageTexture&) = delete;
    SkPromiseImageTexture& operator=(SkPromiseImageTexture&&) = delete;

    static sk_sp<SkPromiseImageTexture> Make(const GrBackendTexture& backendTexture) {
        if (!backendTexture.isValid()) {
            return nullptr;
        }
        return sk_sp<SkPromiseImageTexture>(new SkPromiseImageTexture(backendTexture));
    }

    GrBackendTexture backendTexture() const { return fBackendTexture; }

private:
    explicit SkPromiseImageTexture(const GrBackendTexture& backendTexture);

    GrBackendTexture fBackendTexture;
};
#endif // SK_SUPPORT_GPU

#endif // SkPromiseImageTexture_DEFINED
