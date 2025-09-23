/*
 * Copyright (C) 2017-2022 Apple Inc. All rights reserved.
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

/*
 * =========================== DOM GC OUTPUT CONSTRAINTS EXPLANATION ===========================
 *
 * What is DOMGCOutputConstraint?
 * ------------------------------
 * DOMGCOutputConstraint is a garbage collection marking constraint that ensures certain DOM/WebCore
 * objects are revisited during garbage collection AFTER JavaScript execution (the "mutator") has
 * resumed. This is critical for maintaining GC correctness when objects can create new references
 * or change their reachability graph based on runtime JavaScript state.
 *
 * Why do we need this in Bun?
 * ---------------------------
 * Even though Bun doesn't have a full DOM implementation like a browser, we still use many WebCore
 * types that have "volatile" marking behavior - meaning their references to other objects can change
 * dynamically during JavaScript execution. Without this constraint, we risk:
 *
 * 1. Memory leaks - Objects staying alive that should be collected
 * 2. Premature collection - Objects being freed while still reachable through dynamic references
 * 3. Use-after-free crashes - Accessing collected objects through untracked references
 *
 * How does it work?
 * -----------------
 * 1. During GC, objects are marked through their visitChildren/visitAdditionalChildren methods
 * 2. JavaScript execution resumes (mutator runs)
 * 3. New references may be created or changed during JS execution
 * 4. DOMGCOutputConstraint runs and calls visitOutputConstraints on relevant objects
 * 5. This re-visits the objects to catch any new references created in step 3
 *
 * Which Bun objects need this?
 * ----------------------------
 * Objects that implement visitOutputConstraints() need this constraint. In Bun, these include:
 *
 * - EventTarget & EventEmitter: Dynamic event listener references
 * - MessagePort & MessageChannel: Cross-context messaging with transferable objects
 * - PerformanceObserver: Dynamic observer callbacks
 * - CustomEvent, MessageEvent, ErrorEvent: Event objects with mutable properties
 * - SQLStatement: Prepared statements with dynamic bindings
 * - JSMockFunction: Test mocking with dynamic behavior
 * - Various WebCore types we inherit
 *
 * Relevant WebKit files for reference:
 * ------------------------------------
 * - Source/WebCore/bindings/js/DOMGCOutputConstraint.cpp (original implementation)
 * - Source/WebCore/bindings/js/JSEventTargetCustom.cpp (visitAdditionalChildren example)
 * - Source/WebCore/bindings/js/JSDocumentCustom.cpp (complex marking example)
 * - Source/WebCore/bindings/js/JSMessagePortCustom.cpp (cross-context references)
 * - Source/WebCore/dom/EventTarget.idl (JSCustomMarkFunction attribute)
 * - Source/JavaScriptCore/heap/MarkingConstraint.h (base constraint class)
 *
 * The key insight: Any object whose reachability graph can change based on JavaScript execution
 * state needs output constraints. This is common for objects that:
 * - Maintain event listeners or callbacks
 * - Have cross-context or cross-heap references
 * - Use opaque roots or weak references
 * - Have mutable properties that affect GC reachability
 *
 * =========================================================================================
 */

#include "config.h"

#include <JavaScriptCore/WeakInlines.h>
#include <JavaScriptCore/AbstractSlotVisitorInlines.h>

#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/MarkingConstraint.h>
#include "BunGCOutputConstraint.h"

#include "WebCoreJSClientData.h"
#include <JavaScriptCore/BlockDirectoryInlines.h>
#include <JavaScriptCore/HeapInlines.h>
#include <JavaScriptCore/MarkedBlockInlines.h>
#include <JavaScriptCore/SubspaceInlines.h>

namespace WebCore {

using namespace JSC;

DOMGCOutputConstraint::DOMGCOutputConstraint(VM& vm, JSHeapData& heapData)
    : MarkingConstraint("Domo", "DOM Output", ConstraintVolatility::SeldomGreyed, ConstraintConcurrency::Concurrent, ConstraintParallelism::Parallel)
    , m_vm(vm)
    , m_heapData(heapData)
    , m_lastExecutionVersion(vm.heap.mutatorExecutionVersion())
{
}

DOMGCOutputConstraint::~DOMGCOutputConstraint()
{
}

template<typename Visitor>
void DOMGCOutputConstraint::executeImplImpl(Visitor& visitor)
{
    Heap& heap = m_vm.heap;

    if (heap.mutatorExecutionVersion() == m_lastExecutionVersion)
        return;

    m_lastExecutionVersion = heap.mutatorExecutionVersion();

    m_heapData.forEachOutputConstraintSpace(
        [&](Subspace& subspace) {
            auto func = [](Visitor& visitor, HeapCell* heapCell, HeapCell::Kind) {
                SetRootMarkReasonScope rootScope(visitor, RootMarkReason::DOMGCOutput);
                JSCell* cell = static_cast<JSCell*>(heapCell);
                cell->methodTable()->visitOutputConstraints(cell, visitor);
            };

            RefPtr<SharedTask<void(Visitor&)>> task = subspace.template forEachMarkedCellInParallel<Visitor>(func);
            visitor.addParallelConstraintTask(task);
        });
}

void DOMGCOutputConstraint::executeImpl(AbstractSlotVisitor& visitor) { executeImplImpl(visitor); }
void DOMGCOutputConstraint::executeImpl(SlotVisitor& visitor) { executeImplImpl(visitor); }

} // namespace WebCore
