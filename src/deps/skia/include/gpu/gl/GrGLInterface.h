/*
 * Copyright 2011 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef GrGLInterface_DEFINED
#define GrGLInterface_DEFINED

#include "include/core/SkRefCnt.h"
#include "include/gpu/gl/GrGLExtensions.h"
#include "include/gpu/gl/GrGLFunctions.h"

////////////////////////////////////////////////////////////////////////////////

typedef void(*GrGLFuncPtr)();
struct GrGLInterface;


/**
 * Rather than depend on platform-specific GL headers and libraries, we require
 * the client to provide a struct of GL function pointers. This struct can be
 * specified per-GrContext as a parameter to GrContext::MakeGL. If no interface is
 * passed to MakeGL then a default GL interface is created using GrGLMakeNativeInterface().
 * If this returns nullptr then GrContext::MakeGL() will fail.
 *
 * The implementation of GrGLMakeNativeInterface is platform-specific. Several
 * implementations have been provided (for GLX, WGL, EGL, etc), along with an
 * implementation that simply returns nullptr. Clients should select the most
 * appropriate one to build.
 */
SK_API sk_sp<const GrGLInterface> GrGLMakeNativeInterface();
// Deprecated alternative to GrGLMakeNativeInterface().
SK_API const GrGLInterface* GrGLCreateNativeInterface();

/**
 * GrContext uses the following interface to make all calls into OpenGL. When a
 * GrContext is created it is given a GrGLInterface. The interface's function
 * pointers must be valid for the OpenGL context associated with the GrContext.
 * On some platforms, such as Windows, function pointers for OpenGL extensions
 * may vary between OpenGL contexts. So the caller must be careful to use a
 * GrGLInterface initialized for the correct context. All functions that should
 * be available based on the OpenGL's version and extension string must be
 * non-NULL or GrContext creation will fail. This can be tested with the
 * validate() method when the OpenGL context has been made current.
 */
struct SK_API GrGLInterface : public SkRefCnt {
private:
    using INHERITED = SkRefCnt;

#if GR_GL_CHECK_ERROR
    // This is here to avoid having our debug code that checks for a GL error after most GL calls
    // accidentally swallow an OOM that should be reported.
    mutable bool fOOMed = false;
    bool fSuppressErrorLogging = false;
#endif

public:
    GrGLInterface();

    // Validates that the GrGLInterface supports its advertised standard. This means the necessary
    // function pointers have been initialized for both the GL version and any advertised
    // extensions.
    bool validate() const;

#if GR_GL_CHECK_ERROR
    GrGLenum checkError(const char* location, const char* call) const;
    bool checkAndResetOOMed() const;
    void suppressErrorLogging();
#endif

#if GR_TEST_UTILS
    GrGLInterface(const GrGLInterface& that)
            : fStandard(that.fStandard)
            , fExtensions(that.fExtensions)
            , fFunctions(that.fFunctions) {}
#endif

    // Indicates the type of GL implementation
    union {
        GrGLStandard fStandard;
        GrGLStandard fBindingsExported; // Legacy name, will be remove when Chromium is updated.
    };

    GrGLExtensions fExtensions;

    bool hasExtension(const char ext[]) const { return fExtensions.has(ext); }

    /**
     * The function pointers are in a struct so that we can have a compiler generated assignment
     * operator.
     */
    struct Functions {
        GrGLFunction<GrGLActiveTextureFn> fActiveTexture;
        GrGLFunction<GrGLAttachShaderFn> fAttachShader;
        GrGLFunction<GrGLBeginQueryFn> fBeginQuery;
        GrGLFunction<GrGLBindAttribLocationFn> fBindAttribLocation;
        GrGLFunction<GrGLBindBufferFn> fBindBuffer;
        GrGLFunction<GrGLBindFragDataLocationFn> fBindFragDataLocation;
        GrGLFunction<GrGLBindFragDataLocationIndexedFn> fBindFragDataLocationIndexed;
        GrGLFunction<GrGLBindFramebufferFn> fBindFramebuffer;
        GrGLFunction<GrGLBindRenderbufferFn> fBindRenderbuffer;
        GrGLFunction<GrGLBindSamplerFn> fBindSampler;
        GrGLFunction<GrGLBindTextureFn> fBindTexture;
        GrGLFunction<GrGLBindVertexArrayFn> fBindVertexArray;
        GrGLFunction<GrGLBlendBarrierFn> fBlendBarrier;
        GrGLFunction<GrGLBlendColorFn> fBlendColor;
        GrGLFunction<GrGLBlendEquationFn> fBlendEquation;
        GrGLFunction<GrGLBlendFuncFn> fBlendFunc;
        GrGLFunction<GrGLBlitFramebufferFn> fBlitFramebuffer;
        GrGLFunction<GrGLBufferDataFn> fBufferData;
        GrGLFunction<GrGLBufferSubDataFn> fBufferSubData;
        GrGLFunction<GrGLCheckFramebufferStatusFn> fCheckFramebufferStatus;
        GrGLFunction<GrGLClearFn> fClear;
        GrGLFunction<GrGLClearColorFn> fClearColor;
        GrGLFunction<GrGLClearStencilFn> fClearStencil;
        GrGLFunction<GrGLClearTexImageFn> fClearTexImage;
        GrGLFunction<GrGLClearTexSubImageFn> fClearTexSubImage;
        GrGLFunction<GrGLColorMaskFn> fColorMask;
        GrGLFunction<GrGLCompileShaderFn> fCompileShader;
        GrGLFunction<GrGLCompressedTexImage2DFn> fCompressedTexImage2D;
        GrGLFunction<GrGLCompressedTexSubImage2DFn> fCompressedTexSubImage2D;
        GrGLFunction<GrGLCopyTexSubImage2DFn> fCopyTexSubImage2D;
        GrGLFunction<GrGLCreateProgramFn> fCreateProgram;
        GrGLFunction<GrGLCreateShaderFn> fCreateShader;
        GrGLFunction<GrGLCullFaceFn> fCullFace;
        GrGLFunction<GrGLDeleteBuffersFn> fDeleteBuffers;
        GrGLFunction<GrGLDeleteFencesFn> fDeleteFences;
        GrGLFunction<GrGLDeleteFramebuffersFn> fDeleteFramebuffers;
        GrGLFunction<GrGLDeleteProgramFn> fDeleteProgram;
        GrGLFunction<GrGLDeleteQueriesFn> fDeleteQueries;
        GrGLFunction<GrGLDeleteRenderbuffersFn> fDeleteRenderbuffers;
        GrGLFunction<GrGLDeleteSamplersFn> fDeleteSamplers;
        GrGLFunction<GrGLDeleteShaderFn> fDeleteShader;
        GrGLFunction<GrGLDeleteTexturesFn> fDeleteTextures;
        GrGLFunction<GrGLDeleteVertexArraysFn> fDeleteVertexArrays;
        GrGLFunction<GrGLDepthMaskFn> fDepthMask;
        GrGLFunction<GrGLDisableFn> fDisable;
        GrGLFunction<GrGLDisableVertexAttribArrayFn> fDisableVertexAttribArray;
        GrGLFunction<GrGLDrawArraysFn> fDrawArrays;
        GrGLFunction<GrGLDrawArraysIndirectFn> fDrawArraysIndirect;
        GrGLFunction<GrGLDrawArraysInstancedFn> fDrawArraysInstanced;
        GrGLFunction<GrGLDrawBufferFn> fDrawBuffer;
        GrGLFunction<GrGLDrawBuffersFn> fDrawBuffers;
        GrGLFunction<GrGLDrawElementsFn> fDrawElements;
        GrGLFunction<GrGLDrawElementsIndirectFn> fDrawElementsIndirect;
        GrGLFunction<GrGLDrawElementsInstancedFn> fDrawElementsInstanced;
        GrGLFunction<GrGLDrawRangeElementsFn> fDrawRangeElements;
        GrGLFunction<GrGLEnableFn> fEnable;
        GrGLFunction<GrGLEnableVertexAttribArrayFn> fEnableVertexAttribArray;
        GrGLFunction<GrGLEndQueryFn> fEndQuery;
        GrGLFunction<GrGLFinishFn> fFinish;
        GrGLFunction<GrGLFinishFenceFn> fFinishFence;
        GrGLFunction<GrGLFlushFn> fFlush;
        GrGLFunction<GrGLFlushMappedBufferRangeFn> fFlushMappedBufferRange;
        GrGLFunction<GrGLFramebufferRenderbufferFn> fFramebufferRenderbuffer;
        GrGLFunction<GrGLFramebufferTexture2DFn> fFramebufferTexture2D;
        GrGLFunction<GrGLFramebufferTexture2DMultisampleFn> fFramebufferTexture2DMultisample;
        GrGLFunction<GrGLFrontFaceFn> fFrontFace;
        GrGLFunction<GrGLGenBuffersFn> fGenBuffers;
        GrGLFunction<GrGLGenFencesFn> fGenFences;
        GrGLFunction<GrGLGenFramebuffersFn> fGenFramebuffers;
        GrGLFunction<GrGLGenerateMipmapFn> fGenerateMipmap;
        GrGLFunction<GrGLGenQueriesFn> fGenQueries;
        GrGLFunction<GrGLGenRenderbuffersFn> fGenRenderbuffers;
        GrGLFunction<GrGLGenSamplersFn> fGenSamplers;
        GrGLFunction<GrGLGenTexturesFn> fGenTextures;
        GrGLFunction<GrGLGenVertexArraysFn> fGenVertexArrays;
        GrGLFunction<GrGLGetBufferParameterivFn> fGetBufferParameteriv;
        GrGLFunction<GrGLGetErrorFn> fGetError;
        GrGLFunction<GrGLGetFramebufferAttachmentParameterivFn> fGetFramebufferAttachmentParameteriv;
        GrGLFunction<GrGLGetIntegervFn> fGetIntegerv;
        GrGLFunction<GrGLGetMultisamplefvFn> fGetMultisamplefv;
        GrGLFunction<GrGLGetProgramBinaryFn> fGetProgramBinary;
        GrGLFunction<GrGLGetProgramInfoLogFn> fGetProgramInfoLog;
        GrGLFunction<GrGLGetProgramivFn> fGetProgramiv;
        GrGLFunction<GrGLGetQueryObjecti64vFn> fGetQueryObjecti64v;
        GrGLFunction<GrGLGetQueryObjectivFn> fGetQueryObjectiv;
        GrGLFunction<GrGLGetQueryObjectui64vFn> fGetQueryObjectui64v;
        GrGLFunction<GrGLGetQueryObjectuivFn> fGetQueryObjectuiv;
        GrGLFunction<GrGLGetQueryivFn> fGetQueryiv;
        GrGLFunction<GrGLGetRenderbufferParameterivFn> fGetRenderbufferParameteriv;
        GrGLFunction<GrGLGetShaderInfoLogFn> fGetShaderInfoLog;
        GrGLFunction<GrGLGetShaderivFn> fGetShaderiv;
        GrGLFunction<GrGLGetShaderPrecisionFormatFn> fGetShaderPrecisionFormat;
        GrGLFunction<GrGLGetStringFn> fGetString;
        GrGLFunction<GrGLGetStringiFn> fGetStringi;
        GrGLFunction<GrGLGetTexLevelParameterivFn> fGetTexLevelParameteriv;
        GrGLFunction<GrGLGetUniformLocationFn> fGetUniformLocation;
        GrGLFunction<GrGLInsertEventMarkerFn> fInsertEventMarker;
        GrGLFunction<GrGLInvalidateBufferDataFn> fInvalidateBufferData;
        GrGLFunction<GrGLInvalidateBufferSubDataFn> fInvalidateBufferSubData;
        GrGLFunction<GrGLInvalidateFramebufferFn> fInvalidateFramebuffer;
        GrGLFunction<GrGLInvalidateSubFramebufferFn> fInvalidateSubFramebuffer;
        GrGLFunction<GrGLInvalidateTexImageFn> fInvalidateTexImage;
        GrGLFunction<GrGLInvalidateTexSubImageFn> fInvalidateTexSubImage;
        GrGLFunction<GrGLIsTextureFn> fIsTexture;
        GrGLFunction<GrGLLineWidthFn> fLineWidth;
        GrGLFunction<GrGLLinkProgramFn> fLinkProgram;
        GrGLFunction<GrGLProgramBinaryFn> fProgramBinary;
        GrGLFunction<GrGLProgramParameteriFn> fProgramParameteri;
        GrGLFunction<GrGLMapBufferFn> fMapBuffer;
        GrGLFunction<GrGLMapBufferRangeFn> fMapBufferRange;
        GrGLFunction<GrGLMapBufferSubDataFn> fMapBufferSubData;
        GrGLFunction<GrGLMapTexSubImage2DFn> fMapTexSubImage2D;
        GrGLFunction<GrGLMemoryBarrierFn> fMemoryBarrier;
        GrGLFunction<GrGLDrawArraysInstancedBaseInstanceFn> fDrawArraysInstancedBaseInstance;
        GrGLFunction<GrGLDrawElementsInstancedBaseVertexBaseInstanceFn> fDrawElementsInstancedBaseVertexBaseInstance;
        GrGLFunction<GrGLMultiDrawArraysIndirectFn> fMultiDrawArraysIndirect;
        GrGLFunction<GrGLMultiDrawElementsIndirectFn> fMultiDrawElementsIndirect;
        GrGLFunction<GrGLMultiDrawArraysInstancedBaseInstanceFn> fMultiDrawArraysInstancedBaseInstance;
        GrGLFunction<GrGLMultiDrawElementsInstancedBaseVertexBaseInstanceFn> fMultiDrawElementsInstancedBaseVertexBaseInstance;
        GrGLFunction<GrGLPatchParameteriFn> fPatchParameteri;
        GrGLFunction<GrGLPixelStoreiFn> fPixelStorei;
        GrGLFunction<GrGLPolygonModeFn> fPolygonMode;
        GrGLFunction<GrGLPopGroupMarkerFn> fPopGroupMarker;
        GrGLFunction<GrGLPushGroupMarkerFn> fPushGroupMarker;
        GrGLFunction<GrGLQueryCounterFn> fQueryCounter;
        GrGLFunction<GrGLReadBufferFn> fReadBuffer;
        GrGLFunction<GrGLReadPixelsFn> fReadPixels;
        GrGLFunction<GrGLRenderbufferStorageFn> fRenderbufferStorage;

        //  On OpenGL ES there are multiple incompatible extensions that add support for MSAA
        //  and ES3 adds MSAA support to the standard. On an ES3 driver we may still use the
        //  older extensions for performance reasons or due to ES3 driver bugs. We want the function
        //  that creates the GrGLInterface to provide all available functions and internally
        //  we will select among them. They all have a method called glRenderbufferStorageMultisample*.
        //  So we have separate function pointers for GL_IMG/EXT_multisampled_to_texture,
        //  GL_CHROMIUM/ANGLE_framebuffer_multisample/ES3, and GL_APPLE_framebuffer_multisample
        //  variations.
        //
        //  If a driver supports multiple GL_ARB_framebuffer_multisample-style extensions then we will
        //  assume the function pointers for the standard (or equivalent GL_ARB) version have
        //  been preferred over GL_EXT, GL_CHROMIUM, or GL_ANGLE variations that have reduced
        //  functionality.

        //  GL_EXT_multisampled_render_to_texture (preferred) or GL_IMG_multisampled_render_to_texture
        GrGLFunction<GrGLRenderbufferStorageMultisampleFn> fRenderbufferStorageMultisampleES2EXT;
        //  GL_APPLE_framebuffer_multisample
        GrGLFunction<GrGLRenderbufferStorageMultisampleFn> fRenderbufferStorageMultisampleES2APPLE;

        //  This is used to store the pointer for GL_ARB/EXT/ANGLE/CHROMIUM_framebuffer_multisample or
        //  the standard function in ES3+ or GL 3.0+.
        GrGLFunction<GrGLRenderbufferStorageMultisampleFn> fRenderbufferStorageMultisample;

        // Pointer to BindUniformLocationCHROMIUM from the GL_CHROMIUM_bind_uniform_location extension.
        GrGLFunction<GrGLBindUniformLocationFn> fBindUniformLocation;

        GrGLFunction<GrGLResolveMultisampleFramebufferFn> fResolveMultisampleFramebuffer;
        GrGLFunction<GrGLSamplerParameteriFn> fSamplerParameteri;
        GrGLFunction<GrGLSamplerParameterivFn> fSamplerParameteriv;
        GrGLFunction<GrGLScissorFn> fScissor;
        GrGLFunction<GrGLSetFenceFn> fSetFence;
        GrGLFunction<GrGLShaderSourceFn> fShaderSource;
        GrGLFunction<GrGLStencilFuncFn> fStencilFunc;
        GrGLFunction<GrGLStencilFuncSeparateFn> fStencilFuncSeparate;
        GrGLFunction<GrGLStencilMaskFn> fStencilMask;
        GrGLFunction<GrGLStencilMaskSeparateFn> fStencilMaskSeparate;
        GrGLFunction<GrGLStencilOpFn> fStencilOp;
        GrGLFunction<GrGLStencilOpSeparateFn> fStencilOpSeparate;
        GrGLFunction<GrGLTestFenceFn> fTestFence;
        GrGLFunction<GrGLTexBufferFn> fTexBuffer;
        GrGLFunction<GrGLTexBufferRangeFn> fTexBufferRange;
        GrGLFunction<GrGLTexImage2DFn> fTexImage2D;
        GrGLFunction<GrGLTexParameterfFn> fTexParameterf;
        GrGLFunction<GrGLTexParameterfvFn> fTexParameterfv;
        GrGLFunction<GrGLTexParameteriFn> fTexParameteri;
        GrGLFunction<GrGLTexParameterivFn> fTexParameteriv;
        GrGLFunction<GrGLTexSubImage2DFn> fTexSubImage2D;
        GrGLFunction<GrGLTexStorage2DFn> fTexStorage2D;
        GrGLFunction<GrGLTextureBarrierFn> fTextureBarrier;
        GrGLFunction<GrGLDiscardFramebufferFn> fDiscardFramebuffer;
        GrGLFunction<GrGLUniform1fFn> fUniform1f;
        GrGLFunction<GrGLUniform1iFn> fUniform1i;
        GrGLFunction<GrGLUniform1fvFn> fUniform1fv;
        GrGLFunction<GrGLUniform1ivFn> fUniform1iv;
        GrGLFunction<GrGLUniform2fFn> fUniform2f;
        GrGLFunction<GrGLUniform2iFn> fUniform2i;
        GrGLFunction<GrGLUniform2fvFn> fUniform2fv;
        GrGLFunction<GrGLUniform2ivFn> fUniform2iv;
        GrGLFunction<GrGLUniform3fFn> fUniform3f;
        GrGLFunction<GrGLUniform3iFn> fUniform3i;
        GrGLFunction<GrGLUniform3fvFn> fUniform3fv;
        GrGLFunction<GrGLUniform3ivFn> fUniform3iv;
        GrGLFunction<GrGLUniform4fFn> fUniform4f;
        GrGLFunction<GrGLUniform4iFn> fUniform4i;
        GrGLFunction<GrGLUniform4fvFn> fUniform4fv;
        GrGLFunction<GrGLUniform4ivFn> fUniform4iv;
        GrGLFunction<GrGLUniformMatrix2fvFn> fUniformMatrix2fv;
        GrGLFunction<GrGLUniformMatrix3fvFn> fUniformMatrix3fv;
        GrGLFunction<GrGLUniformMatrix4fvFn> fUniformMatrix4fv;
        GrGLFunction<GrGLUnmapBufferFn> fUnmapBuffer;
        GrGLFunction<GrGLUnmapBufferSubDataFn> fUnmapBufferSubData;
        GrGLFunction<GrGLUnmapTexSubImage2DFn> fUnmapTexSubImage2D;
        GrGLFunction<GrGLUseProgramFn> fUseProgram;
        GrGLFunction<GrGLVertexAttrib1fFn> fVertexAttrib1f;
        GrGLFunction<GrGLVertexAttrib2fvFn> fVertexAttrib2fv;
        GrGLFunction<GrGLVertexAttrib3fvFn> fVertexAttrib3fv;
        GrGLFunction<GrGLVertexAttrib4fvFn> fVertexAttrib4fv;
        GrGLFunction<GrGLVertexAttribDivisorFn> fVertexAttribDivisor;
        GrGLFunction<GrGLVertexAttribIPointerFn> fVertexAttribIPointer;
        GrGLFunction<GrGLVertexAttribPointerFn> fVertexAttribPointer;
        GrGLFunction<GrGLViewportFn> fViewport;

        /* NV_framebuffer_mixed_samples */
        GrGLFunction<GrGLCoverageModulationFn> fCoverageModulation;

        /* ARB_sync */
        GrGLFunction<GrGLFenceSyncFn> fFenceSync;
        GrGLFunction<GrGLIsSyncFn> fIsSync;
        GrGLFunction<GrGLClientWaitSyncFn> fClientWaitSync;
        GrGLFunction<GrGLWaitSyncFn> fWaitSync;
        GrGLFunction<GrGLDeleteSyncFn> fDeleteSync;

        /* ARB_internalforamt_query */
        GrGLFunction<GrGLGetInternalformativFn> fGetInternalformativ;

        /* KHR_debug */
        GrGLFunction<GrGLDebugMessageControlFn> fDebugMessageControl;
        GrGLFunction<GrGLDebugMessageInsertFn> fDebugMessageInsert;
        GrGLFunction<GrGLDebugMessageCallbackFn> fDebugMessageCallback;
        GrGLFunction<GrGLGetDebugMessageLogFn> fGetDebugMessageLog;
        GrGLFunction<GrGLPushDebugGroupFn> fPushDebugGroup;
        GrGLFunction<GrGLPopDebugGroupFn> fPopDebugGroup;
        GrGLFunction<GrGLObjectLabelFn> fObjectLabel;

        /* EXT_window_rectangles */
        GrGLFunction<GrGLWindowRectanglesFn> fWindowRectangles;

        /* GL_QCOM_tiled_rendering */
        GrGLFunction<GrGLStartTilingFn> fStartTiling;
        GrGLFunction<GrGLEndTilingFn> fEndTiling;
    } fFunctions;

#if GR_TEST_UTILS
    // This exists for internal testing.
    virtual void abandon() const;
#endif
};

#endif
