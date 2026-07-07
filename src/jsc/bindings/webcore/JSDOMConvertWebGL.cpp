/*
 * Copyright (C) 2017 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "JSDOMConvertWebGL.h"

#if ENABLE(WEBGL)

#include "JSANGLEInstancedArrays.h"
#include "JSDOMConvertBufferSource.h"
#include "JSEXTBlendMinMax.h"
#include "JSEXTColorBufferFloat.h"
#include "JSEXTColorBufferHalfFloat.h"
#include "JSEXTFloatBlend.h"
#include "JSEXTFragDepth.h"
#include "JSEXTShaderTextureLOD.h"
#include "JSEXTTextureCompressionRGTC.h"
#include "JSEXTTextureFilterAnisotropic.h"
#include "JSEXTsRGB.h"
#include "JSKHRParallelShaderCompile.h"
#include "JSOESElementIndexUint.h"
#include "JSOESFBORenderMipmap.h"
#include "JSOESStandardDerivatives.h"
#include "JSOESTextureFloat.h"
#include "JSOESTextureFloatLinear.h"
#include "JSOESTextureHalfFloat.h"
#include "JSOESTextureHalfFloatLinear.h"
#include "JSOESVertexArrayObject.h"
#include "JSWebGLBuffer.h"
#include "JSWebGLColorBufferFloat.h"
#include "JSWebGLCompressedTextureASTC.h"
#include "JSWebGLCompressedTextureATC.h"
#include "JSWebGLCompressedTextureETC.h"
#include "JSWebGLCompressedTextureETC1.h"
#include "JSWebGLCompressedTexturePVRTC.h"
#include "JSWebGLCompressedTextureS3TC.h"
#include "JSWebGLCompressedTextureS3TCsRGB.h"
#include "JSWebGLDebugRendererInfo.h"
#include "JSWebGLDebugShaders.h"
#include "JSWebGLDepthTexture.h"
#include "JSWebGLDrawBuffers.h"
#include "JSWebGLFramebuffer.h"
#include "JSWebGLLoseContext.h"
#include "JSWebGLMultiDraw.h"
#include "JSWebGLProgram.h"
#include "JSWebGLRenderbuffer.h"
#include "JSWebGLSampler.h"
#include "JSWebGLTexture.h"
#include "JSWebGLTransformFeedback.h"
#include "JSWebGLVertexArrayObject.h"
#include "JSWebGLVertexArrayObjectOES.h"

namespace WebCore {
using namespace JSC;

// FIXME: This should use the IDLUnion JSConverter.
JSValue convertToJSValue(JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, const WebGLAny& any)
{
    return WTF::switchOn(
        any,
        [](std::nullptr_t) -> JSValue {
            return jsNull();
        },
        [](bool value) -> JSValue {
            return jsBoolean(value);
        },
        [](int value) -> JSValue {
            return jsNumber(value);
        },
        [](unsigned value) -> JSValue {
            return jsNumber(value);
        },
        [](long long value) -> JSValue {
            return jsNumber(value);
        },
        [](float value) -> JSValue {
            return jsNumber(value);
        },
        [&](const String& value) -> JSValue {
            return jsStringWithCache(lexicalGlobalObject.vm(), value);
        },
        [&](const Vector<bool>& values) -> JSValue {
            MarkedArgumentBuffer list;
            for (auto& value : values)
                list.append(jsBoolean(value));
            RELEASE_ASSERT(!list.hasOverflowed());
            return constructArray(&globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), list);
        },
        [&](const Vector<int>& values) -> JSValue {
            MarkedArgumentBuffer list;
            for (auto& value : values)
                list.append(jsNumber(value));
            RELEASE_ASSERT(!list.hasOverflowed());
            return constructArray(&globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), list);
        },
        [&](const Vector<unsigned>& values) -> JSValue {
            MarkedArgumentBuffer list;
            for (auto& value : values)
                list.append(jsNumber(value));
            RELEASE_ASSERT(!list.hasOverflowed());
            return constructArray(&globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), list);
        },
        [&](const RefPtr<Float16Array>& array) {
            return toJS(&lexicalGlobalObject, &globalObject, array.get());
        },
        [&](const RefPtr<Float32Array>& array) {
            return toJS(&lexicalGlobalObject, &globalObject, array.get());
        },
        [&](const RefPtr<Int32Array>& array) {
            return toJS(&lexicalGlobalObject, &globalObject, array.get());
        },
        [&](const RefPtr<Uint8Array>& array) {
            return toJS(&lexicalGlobalObject, &globalObject, array.get());
        },
        [&](const RefPtr<Uint32Array>& array) {
            return toJS(&lexicalGlobalObject, &globalObject, array.get());
        },
        [&](const RefPtr<WebGLBuffer>& buffer) {
            return toJS(&lexicalGlobalObject, &globalObject, buffer.get());
        },
        [&](const RefPtr<WebGLFramebuffer>& buffer) {
            return toJS(&lexicalGlobalObject, &globalObject, buffer.get());
        },
        [&](const RefPtr<WebGLProgram>& program) {
            return toJS(&lexicalGlobalObject, &globalObject, program.get());
        },
        [&](const RefPtr<WebGLRenderbuffer>& buffer) {
            return toJS(&lexicalGlobalObject, &globalObject, buffer.get());
        },
        [&](const RefPtr<WebGLTexture>& texture) {
            return toJS(&lexicalGlobalObject, &globalObject, texture.get());
        },
        [&](const RefPtr<WebGLVertexArrayObjectOES>& array) {
            return toJS(&lexicalGlobalObject, &globalObject, array.get());
        }
#if ENABLE(WEBGL2)
        ,
        [&](const RefPtr<WebGLSampler>& sampler) {
            return toJS(&lexicalGlobalObject, &globalObject, sampler.get());
        },
        [&](const RefPtr<WebGLTransformFeedback>& transformFeedback) {
            return toJS(&lexicalGlobalObject, &globalObject, transformFeedback.get());
        },
        [&](const RefPtr<WebGLVertexArrayObject>& array) {
            return toJS(&lexicalGlobalObject, &globalObject, array.get());
        }
#endif
    );
}

JSValue convertToJSValue(JSGlobalObject& lexicalGlobalObject, JSDOMGlobalObject& globalObject, WebGLExtension& extension)
{
    switch (extension.getName()) {
    case WebGLExtension::WebGLLoseContextName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<WebGLLoseContext&>(extension));
    case WebGLExtension::EXTShaderTextureLODName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<EXTShaderTextureLOD&>(extension));
    case WebGLExtension::EXTTextureCompressionRGTCName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<EXTTextureCompressionRGTC&>(extension));
    case WebGLExtension::EXTTextureFilterAnisotropicName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<EXTTextureFilterAnisotropic&>(extension));
    case WebGLExtension::EXTsRGBName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<EXTsRGB&>(extension));
    case WebGLExtension::EXTFragDepthName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<EXTFragDepth&>(extension));
    case WebGLExtension::EXTBlendMinMaxName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<EXTBlendMinMax&>(extension));
    case WebGLExtension::KHRParallelShaderCompileName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<KHRParallelShaderCompile&>(extension));
    case WebGLExtension::OESStandardDerivativesName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<OESStandardDerivatives&>(extension));
    case WebGLExtension::OESTextureFloatName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<OESTextureFloat&>(extension));
    case WebGLExtension::OESTextureFloatLinearName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<OESTextureFloatLinear&>(extension));
    case WebGLExtension::OESTextureHalfFloatName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<OESTextureHalfFloat&>(extension));
    case WebGLExtension::OESTextureHalfFloatLinearName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<OESTextureHalfFloatLinear&>(extension));
    case WebGLExtension::OESVertexArrayObjectName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<OESVertexArrayObject&>(extension));
    case WebGLExtension::OESElementIndexUintName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<OESElementIndexUint&>(extension));
    case WebGLExtension::OESFBORenderMipmapName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<OESFBORenderMipmap&>(extension));
    case WebGLExtension::WebGLDebugRendererInfoName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<WebGLDebugRendererInfo&>(extension));
    case WebGLExtension::WebGLDebugShadersName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<WebGLDebugShaders&>(extension));
    case WebGLExtension::WebGLCompressedTextureATCName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<WebGLCompressedTextureATC&>(extension));
    case WebGLExtension::WebGLCompressedTextureETCName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<WebGLCompressedTextureETC&>(extension));
    case WebGLExtension::WebGLCompressedTextureETC1Name:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<WebGLCompressedTextureETC1&>(extension));
    case WebGLExtension::WebGLCompressedTexturePVRTCName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<WebGLCompressedTexturePVRTC&>(extension));
    case WebGLExtension::WebGLCompressedTextureS3TCName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<WebGLCompressedTextureS3TC&>(extension));
    case WebGLExtension::WebGLCompressedTextureS3TCsRGBName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<WebGLCompressedTextureS3TCsRGB&>(extension));
    case WebGLExtension::WebGLCompressedTextureASTCName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<WebGLCompressedTextureASTC&>(extension));
    case WebGLExtension::WebGLDepthTextureName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<WebGLDepthTexture&>(extension));
    case WebGLExtension::WebGLDrawBuffersName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<WebGLDrawBuffers&>(extension));
    case WebGLExtension::ANGLEInstancedArraysName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<ANGLEInstancedArrays&>(extension));
    case WebGLExtension::EXTColorBufferHalfFloatName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<EXTColorBufferHalfFloat&>(extension));
    case WebGLExtension::EXTFloatBlendName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<EXTFloatBlend&>(extension));
    case WebGLExtension::WebGLColorBufferFloatName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<WebGLColorBufferFloat&>(extension));
    case WebGLExtension::EXTColorBufferFloatName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<EXTColorBufferFloat&>(extension));
    case WebGLExtension::WebGLMultiDrawName:
        return toJS(&lexicalGlobalObject, &globalObject, static_cast<WebGLMultiDraw&>(extension));
    }
    ASSERT_NOT_REACHED();
    return jsNull();
}

}

#endif
