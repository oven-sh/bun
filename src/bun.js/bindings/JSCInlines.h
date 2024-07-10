/*
 * Copyright (C) 2014-2017 Apple Inc. All rights reserved.
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

#pragma once

// This file's only purpose is to collect commonly used *Inlines.h files, so that you don't
// have to include all of them in every .cpp file. Instead you just include this. It's good
// style to make sure that every .cpp file includes JSCInlines.h.
//
// JSC should never include this file, or any *Inline.h file, from interface headers, since
// this could lead to a circular dependency.
//
// WebCore, or any other downstream client of JSC, is allowed to include this file in headers.
// In fact, it can make a lot of sense: outside of JSC, this file becomes a kind of umbrella
// header that pulls in most (all?) of the interesting things in JSC.

#include <JavaScriptCore/ExceptionHelpers.h>
#include <JavaScriptCore/GCIncomingRefCountedInlines.h>
#include <JavaScriptCore/HeapInlines.h>
#include <JavaScriptCore/IdentifierInlines.h>
#include <JavaScriptCore/JSArrayBufferViewInlines.h>
#include <JavaScriptCore/JSCJSValueInlines.h>
#include <JavaScriptCore/JSCellInlines.h>
#include <JavaScriptCore/JSFunctionInlines.h>
#include <JavaScriptCore/JSGlobalObjectInlines.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/JSGlobalProxy.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/Operations.h>
#include <JavaScriptCore/SlotVisitorInlines.h>
#include <JavaScriptCore/StrongInlines.h>
#include <JavaScriptCore/StructureInlines.h>
#include <JavaScriptCore/ThrowScope.h>
#include <JavaScriptCore/WeakGCMapInlines.h>
#include <JavaScriptCore/WeakGCSetInlines.h>
