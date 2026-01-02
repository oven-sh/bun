/*
 * Copyright (c) 2021 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#ifndef BMALLOC_HEAP_REF_H
#define BMALLOC_HEAP_REF_H

#include <bmalloc/bmalloc_type.h>
#include <bmalloc/pas_heap_ref.h>

PAS_BEGIN_EXTERN_C;

#define BMALLOC_HEAP_REF_INITIALIZER(passed_type)    \
    ((pas_heap_ref) {                                \
        .type = (const pas_heap_type*)(passed_type), \
        .heap = NULL,                                \
        .allocator_index = 0 })

#define BMALLOC_PRIMITIVE_HEAP_REF_INITIALIZER_IMPL(passed_type) \
    ((pas_primitive_heap_ref) {                                  \
        .base = BMALLOC_HEAP_REF_INITIALIZER(passed_type),       \
        .cached_index = UINT_MAX })

#define BMALLOC_FLEX_HEAP_REF_INITIALIZER(passed_type) \
    BMALLOC_PRIMITIVE_HEAP_REF_INITIALIZER_IMPL(passed_type)

#define BMALLOC_AUXILIARY_HEAP_REF_INITIALIZER(passed_type) \
    BMALLOC_PRIMITIVE_HEAP_REF_INITIALIZER_IMPL(passed_type)

PAS_END_EXTERN_C;

#endif /* BMALLOC_HEAP_REF_H */
