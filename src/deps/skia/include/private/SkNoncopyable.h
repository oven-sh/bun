/*
 * Copyright 2006 The Android Open Source Project
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

#ifndef SkNoncopyable_DEFINED
#define SkNoncopyable_DEFINED

#include "include/core/SkTypes.h"

/** \class SkNoncopyable

    SkNoncopyable is the base class for objects that do not want to
    be copied. It hides its copy-constructor and its assignment-operator.
*/
class SK_API SkNoncopyable {
public:
    SkNoncopyable() = default;

    SkNoncopyable(SkNoncopyable&&) = default;
    SkNoncopyable& operator =(SkNoncopyable&&) = default;

private:
    SkNoncopyable(const SkNoncopyable&) = delete;
    SkNoncopyable& operator=(const SkNoncopyable&) = delete;
};

#endif
