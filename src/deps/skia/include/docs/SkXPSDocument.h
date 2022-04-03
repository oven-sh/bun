/*
 * Copyright 2017 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkXPSDocument_DEFINED
#define SkXPSDocument_DEFINED

#include "include/core/SkTypes.h"

#ifdef SK_BUILD_FOR_WIN

#include "include/core/SkDocument.h"

struct IXpsOMObjectFactory;

namespace SkXPS {

SK_API sk_sp<SkDocument> MakeDocument(SkWStream* stream,
                                      IXpsOMObjectFactory* xpsFactory,
                                      SkScalar dpi = SK_ScalarDefaultRasterDPI);

}  // namespace SkXPS
#endif  // SK_BUILD_FOR_WIN
#endif  // SkXPSDocument_DEFINED
