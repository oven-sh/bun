
/*
 * Copyright 2010 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef GrConfig_DEFINED
#define GrConfig_DEFINED

#include "include/core/SkTypes.h"

/**
 *  Gr defines are set to 0 or 1, rather than being undefined or defined
 */

#if !defined(GR_CACHE_STATS)
  #if defined(SK_DEBUG) || defined(SK_DUMP_STATS)
      #define GR_CACHE_STATS  1
  #else
      #define GR_CACHE_STATS  0
  #endif
#endif

#if !defined(GR_GPU_STATS)
  #if defined(SK_DEBUG) || defined(SK_DUMP_STATS) || GR_TEST_UTILS
      #define GR_GPU_STATS    1
  #else
      #define GR_GPU_STATS    0
  #endif
#endif

#endif

/**
 *  GR_STRING makes a string of X where X is expanded before conversion to a string
 *  if X itself contains macros.
 */
#define GR_STRING(X) GR_STRING_IMPL(X)
#define GR_STRING_IMPL(X) #X

/**
 *  GR_CONCAT concatenates X and Y  where each is expanded before
 *  contanenation if either contains macros.
 */
#define GR_CONCAT(X,Y) GR_CONCAT_IMPL(X,Y)
#define GR_CONCAT_IMPL(X,Y) X##Y

/**
 *  Creates a string of the form "<filename>(<linenumber>) : "
 */
#define GR_FILE_AND_LINE_STR __FILE__ "(" GR_STRING(__LINE__) ") : "
