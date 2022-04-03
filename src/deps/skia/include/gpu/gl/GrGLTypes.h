
/*
 * Copyright 2015 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef GrGLTypes_DEFINED
#define GrGLTypes_DEFINED

#include "include/core/SkRefCnt.h"
#include "include/gpu/gl/GrGLConfig.h"

/**
 * Classifies GL contexts by which standard they implement (currently as OpenGL vs. OpenGL ES).
 */
enum GrGLStandard {
    kNone_GrGLStandard,
    kGL_GrGLStandard,
    kGLES_GrGLStandard,
    kWebGL_GrGLStandard,
};
static const int kGrGLStandardCnt = 4;

// The following allow certain interfaces to be turned off at compile time
// (for example, to lower code size).
#if SK_ASSUME_GL_ES
    #define GR_IS_GR_GL(standard) false
    #define GR_IS_GR_GL_ES(standard) true
    #define GR_IS_GR_WEBGL(standard) false
    #define SK_DISABLE_GL_INTERFACE 1
    #define SK_DISABLE_WEBGL_INTERFACE 1
#elif SK_ASSUME_GL
    #define GR_IS_GR_GL(standard) true
    #define GR_IS_GR_GL_ES(standard) false
    #define GR_IS_GR_WEBGL(standard) false
    #define SK_DISABLE_GL_ES_INTERFACE 1
    #define SK_DISABLE_WEBGL_INTERFACE 1
#elif SK_ASSUME_WEBGL
    #define GR_IS_GR_GL(standard) false
    #define GR_IS_GR_GL_ES(standard) false
    #define GR_IS_GR_WEBGL(standard) true
    #define SK_DISABLE_GL_ES_INTERFACE 1
    #define SK_DISABLE_GL_INTERFACE 1
#else
    #define GR_IS_GR_GL(standard) (kGL_GrGLStandard == standard)
    #define GR_IS_GR_GL_ES(standard) (kGLES_GrGLStandard == standard)
    #define GR_IS_GR_WEBGL(standard) (kWebGL_GrGLStandard == standard)
#endif

///////////////////////////////////////////////////////////////////////////////

/**
 * The supported GL formats represented as an enum. Actual support by GrContext depends on GL
 * context version and extensions.
 */
enum class GrGLFormat {
    kUnknown,

    kRGBA8,
    kR8,
    kALPHA8,
    kLUMINANCE8,
    kLUMINANCE8_ALPHA8,
    kBGRA8,
    kRGB565,
    kRGBA16F,
    kR16F,
    kRGB8,
    kRGBX8,
    kRG8,
    kRGB10_A2,
    kRGBA4,
    kSRGB8_ALPHA8,
    kCOMPRESSED_ETC1_RGB8,
    kCOMPRESSED_RGB8_ETC2,
    kCOMPRESSED_RGB8_BC1,
    kCOMPRESSED_RGBA8_BC1,
    kR16,
    kRG16,
    kRGBA16,
    kRG16F,
    kLUMINANCE16F,

    kLastColorFormat = kLUMINANCE16F,

    // Depth/Stencil formats
    kSTENCIL_INDEX8,
    kSTENCIL_INDEX16,
    kDEPTH24_STENCIL8,

    kLast = kDEPTH24_STENCIL8
};

///////////////////////////////////////////////////////////////////////////////
/**
 * Declares typedefs for all the GL functions used in GrGLInterface
 */

typedef unsigned int GrGLenum;
typedef unsigned char GrGLboolean;
typedef unsigned int GrGLbitfield;
typedef signed char GrGLbyte;
typedef char GrGLchar;
typedef short GrGLshort;
typedef int GrGLint;
typedef int GrGLsizei;
typedef int64_t GrGLint64;
typedef unsigned char GrGLubyte;
typedef unsigned short GrGLushort;
typedef unsigned int GrGLuint;
typedef uint64_t GrGLuint64;
typedef unsigned short int GrGLhalf;
typedef float GrGLfloat;
typedef float GrGLclampf;
typedef double GrGLdouble;
typedef double GrGLclampd;
typedef void GrGLvoid;
#ifdef _WIN64
typedef signed long long int GrGLintptr;
typedef signed long long int GrGLsizeiptr;
#else
typedef signed long int GrGLintptr;
typedef signed long int GrGLsizeiptr;
#endif
typedef void* GrGLeglImage;
typedef struct __GLsync* GrGLsync;

struct GrGLDrawArraysIndirectCommand {
    GrGLuint fCount;
    GrGLuint fInstanceCount;
    GrGLuint fFirst;
    GrGLuint fBaseInstance;  // Requires EXT_base_instance on ES.
};

// static_asserts must have messages in this file because its included in C++14 client code.
static_assert(16 == sizeof(GrGLDrawArraysIndirectCommand), "");

struct GrGLDrawElementsIndirectCommand {
    GrGLuint fCount;
    GrGLuint fInstanceCount;
    GrGLuint fFirstIndex;
    GrGLuint fBaseVertex;
    GrGLuint fBaseInstance;  // Requires EXT_base_instance on ES.
};

static_assert(20 == sizeof(GrGLDrawElementsIndirectCommand), "");

/**
 * KHR_debug
 */
typedef void (GR_GL_FUNCTION_TYPE* GRGLDEBUGPROC)(GrGLenum source,
                                                  GrGLenum type,
                                                  GrGLuint id,
                                                  GrGLenum severity,
                                                  GrGLsizei length,
                                                  const GrGLchar* message,
                                                  const void* userParam);

/**
 * EGL types.
 */
typedef void* GrEGLImage;
typedef void* GrEGLDisplay;
typedef void* GrEGLContext;
typedef void* GrEGLClientBuffer;
typedef unsigned int GrEGLenum;
typedef int32_t GrEGLint;
typedef unsigned int GrEGLBoolean;

///////////////////////////////////////////////////////////////////////////////
/**
 * Types for interacting with GL resources created externally to Skia. GrBackendObjects for GL
 * textures are really const GrGLTexture*. The fFormat here should be a sized, internal format
 * for the texture. We will try to use the sized format if the GL Context supports it, otherwise
 * we will internally fall back to using the base internal formats.
 */
struct GrGLTextureInfo {
    GrGLenum fTarget;
    GrGLuint fID;
    GrGLenum fFormat = 0;

    bool operator==(const GrGLTextureInfo& that) const {
        return fTarget == that.fTarget && fID == that.fID && fFormat == that.fFormat;
    }
};

struct GrGLFramebufferInfo {
    GrGLuint fFBOID;
    GrGLenum fFormat = 0;

    bool operator==(const GrGLFramebufferInfo& that) const {
        return fFBOID == that.fFBOID && fFormat == that.fFormat;
    }
};

struct GrGLSurfaceInfo {
    uint32_t fSampleCount = 1;
    uint32_t fLevelCount = 0;
    GrProtected fProtected = GrProtected::kNo;

    GrGLenum fTarget = 0;
    GrGLenum fFormat = 0;
};

#endif
