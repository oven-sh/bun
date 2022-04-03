
/*
 * Copyright 2011 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */



#ifndef GrGLConfig_DEFINED
#define GrGLConfig_DEFINED

#include "include/gpu/GrTypes.h"

/**
 * Optional GL config file.
 */
#ifdef GR_GL_CUSTOM_SETUP_HEADER
    #include GR_GL_CUSTOM_SETUP_HEADER
#endif

#if !defined(GR_GL_FUNCTION_TYPE)
    #if defined(SK_BUILD_FOR_WIN)
        #define GR_GL_FUNCTION_TYPE __stdcall
    #else
        #define GR_GL_FUNCTION_TYPE
    #endif
#endif

/**
 * The following are optional defines that can be enabled at the compiler
 * command line, in a IDE project, in a GrUserConfig.h file, or in a GL custom
 * file (if one is in use). If a GR_GL_CUSTOM_SETUP_HEADER is used they can
 * also be placed there.
 *
 * GR_GL_LOG_CALLS: if 1 Gr can print every GL call using SkDebugf. Defaults to
 * 0. Logging can be enabled and disabled at runtime using a debugger via to
 * global gLogCallsGL. The initial value of gLogCallsGL is controlled by
 * GR_GL_LOG_CALLS_START.
 *
 * GR_GL_LOG_CALLS_START: controls the initial value of gLogCallsGL when
 * GR_GL_LOG_CALLS is 1. Defaults to 0.
 *
 * GR_GL_CHECK_ERROR: if enabled Gr can do a glGetError() after every GL call.
 * Defaults to 1 if SK_DEBUG is set, otherwise 0. When GR_GL_CHECK_ERROR is 1
 * this can be toggled in a debugger using the gCheckErrorGL global. The initial
 * value of gCheckErrorGL is controlled by by GR_GL_CHECK_ERROR_START.
 *
 * GR_GL_CHECK_ERROR_START: controls the initial value of gCheckErrorGL
 * when GR_GL_CHECK_ERROR is 1.  Defaults to 1.
 *
 */

#if !defined(GR_GL_LOG_CALLS)
    #ifdef SK_DEBUG
        #define GR_GL_LOG_CALLS 1
    #else
        #define GR_GL_LOG_CALLS 0
    #endif
#endif

#if !defined(GR_GL_LOG_CALLS_START)
    #define GR_GL_LOG_CALLS_START                       0
#endif

#if !defined(GR_GL_CHECK_ERROR)
    #ifdef SK_DEBUG
        #define GR_GL_CHECK_ERROR 1
    #else
        #define GR_GL_CHECK_ERROR 0
    #endif
#endif

#if !defined(GR_GL_CHECK_ERROR_START)
    #define GR_GL_CHECK_ERROR_START                     1
#endif

#endif
