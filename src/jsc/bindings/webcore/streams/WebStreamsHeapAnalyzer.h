// WebStreamsHeapAnalyzer.h — the one helper every Web Streams cell's analyzeHeap() uses to
// report its WriteBarrier members as NAMED edges to the heap snapshot builder, so retained
// paths in a snapshot read `ReadableStream --controller--> ReadableStreamDefaultController`
// instead of an anonymous internal edge.
#pragma once

#include "root.h"

#include <JavaScriptCore/HeapAnalyzer.h>
#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSCJSValue.h>
#include <JavaScriptCore/JSCell.h>
#include <JavaScriptCore/WriteBarrier.h>

namespace Bun {
namespace WebStreams {

// WriteBarrier<T> where T : JSCell — .get() is a T*.
template<typename T>
ALWAYS_INLINE void analyzeBarrierEdge(JSC::VM& vm, JSC::HeapAnalyzer& analyzer, JSC::JSCell* from, const JSC::WriteBarrier<T>& barrier, ASCIILiteral name)
{
    if (JSC::JSCell* to = barrier.get())
        analyzer.analyzePropertyNameEdge(from, to, JSC::Identifier::fromString(vm, name).impl());
}

// WriteBarrier<Unknown> — .get() is a JSValue.
ALWAYS_INLINE void analyzeBarrierEdge(JSC::VM& vm, JSC::HeapAnalyzer& analyzer, JSC::JSCell* from, const JSC::WriteBarrier<JSC::Unknown>& barrier, ASCIILiteral name)
{
    JSC::JSValue value = barrier.get();
    if (value && value.isCell())
        analyzer.analyzePropertyNameEdge(from, value.asCell(), JSC::Identifier::fromString(vm, name).impl());
}

} // namespace WebStreams
} // namespace Bun
