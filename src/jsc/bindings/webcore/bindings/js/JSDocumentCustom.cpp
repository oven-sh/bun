/*
 * Copyright (C) 2007-2021 Apple Inc. All rights reserved.
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Library General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Library General Public License for more details.
 *
 * You should have received a copy of the GNU Library General Public License
 * along with this library; see the file COPYING.LIB.  If not, write to
 * the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
 * Boston, MA 02110-1301, USA.
 */

#include "config.h"
#include "JSDocument.h"

#include "JSDOMWrapperCache.h"
#include "NodeTraversal.h"
#include <JavaScriptCore/HeapAnalyzer.h>

namespace WebCore {
using namespace JSC;

JSObject* cachedDocumentWrapper(JSGlobalObject&, JSDOMGlobalObject& globalObject, Document& document)
{
    return getCachedWrapper(globalObject.world(), document);
}

void reportMemoryForDocumentIfFrameless(JSGlobalObject& lexicalGlobalObject, Document& document)
{
    VM& vm = lexicalGlobalObject.vm();
    size_t memoryCost = 0;
    for (CheckedPtr<Node> node = &document; node; node = NodeTraversal::next(*node))
        memoryCost += node->approximateMemoryCost();

    // FIXME: Adopt reportExtraMemoryVisited, and switch to reportExtraMemoryAllocated.
    // https://bugs.webkit.org/show_bug.cgi?id=142595
    vm.heap.deprecatedReportExtraMemory(memoryCost);
}

// JSNode adds the document as an opaque root, and that is the root the window's wrapper shares.
template<typename Visitor>
void JSDocument::visitAdditionalChildrenInGCThread(Visitor&)
{
}

DEFINE_VISIT_ADDITIONAL_CHILDREN_IN_GC_THREAD(JSDocument);

void JSDocument::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    Base::analyzeHeap(cell, analyzer);
    auto* thisObject = downcast<JSDocument>(cell);
    analyzer.setLabelForCell(cell, thisObject->wrapped().url().string());
}

} // namespace WebCore
