/*
 * Copyright 2012 Google Inc.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkAnnotation_DEFINED
#define SkAnnotation_DEFINED

#include "include/core/SkTypes.h"

class SkData;
struct SkPoint;
struct SkRect;
class SkCanvas;

/**
 *  Annotate the canvas by associating the specified URL with the
 *  specified rectangle (in local coordinates, just like drawRect).
 *
 *  If the backend of this canvas does not support annotations, this call is
 *  safely ignored.
 *
 *  The caller is responsible for managing its ownership of the SkData.
 */
SK_API void SkAnnotateRectWithURL(SkCanvas*, const SkRect&, SkData*);

/**
 *  Annotate the canvas by associating a name with the specified point.
 *
 *  If the backend of this canvas does not support annotations, this call is
 *  safely ignored.
 *
 *  The caller is responsible for managing its ownership of the SkData.
 */
SK_API void SkAnnotateNamedDestination(SkCanvas*, const SkPoint&, SkData*);

/**
 *  Annotate the canvas by making the specified rectangle link to a named
 *  destination.
 *
 *  If the backend of this canvas does not support annotations, this call is
 *  safely ignored.
 *
 *  The caller is responsible for managing its ownership of the SkData.
 */
SK_API void SkAnnotateLinkToDestination(SkCanvas*, const SkRect&, SkData*);

#endif
