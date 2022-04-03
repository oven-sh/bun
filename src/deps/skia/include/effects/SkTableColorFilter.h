/*
* Copyright 2015 Google Inc.
*
* Use of this source code is governed by a BSD-style license that can be
* found in the LICENSE file.
*/

#ifndef SkTableColorFilter_DEFINED
#define SkTableColorFilter_DEFINED

#include "include/core/SkColorFilter.h"

class SK_API SkTableColorFilter {
public:
    /**
     *  Create a table colorfilter, copying the table into the filter, and
     *  applying it to all 4 components.
     *      a' = table[a];
     *      r' = table[r];
     *      g' = table[g];
     *      b' = table[b];
     *  Compoents are operated on in unpremultiplied space. If the incomming
     *  colors are premultiplied, they are temporarily unpremultiplied, then
     *  the table is applied, and then the result is remultiplied.
     */
    static sk_sp<SkColorFilter> Make(const uint8_t table[256]);

    /**
     *  Create a table colorfilter, with a different table for each
     *  component [A, R, G, B]. If a given table is NULL, then it is
     *  treated as identity, with the component left unchanged. If a table
     *  is not null, then its contents are copied into the filter.
     */
    static sk_sp<SkColorFilter> MakeARGB(const uint8_t tableA[256],
                                         const uint8_t tableR[256],
                                         const uint8_t tableG[256],
                                         const uint8_t tableB[256]);

    static void RegisterFlattenables();
};

#endif
