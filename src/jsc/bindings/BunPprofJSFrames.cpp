// Runs inside malloc (src/pprof/heap.rs): nothing here may allocate, wait for a lock or touch the GC.

#include "root.h"

#include <JavaScriptCore/CallFrame.h>
#include <JavaScriptCore/CodeBlock.h>
#include <JavaScriptCore/CodeBlockSet.h>
#include <JavaScriptCore/ExecutableAllocator.h>
#include <JavaScriptCore/FunctionExecutable.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/NativeExecutable.h>
#include <JavaScriptCore/StackVisitor.h>
#include <JavaScriptCore/VM.h>

// llint/LLIntPCRanges.h is not an installed header.
extern "C" void llintPCRangeStart();
extern "C" void llintPCRangeEnd();
extern "C" bool Bun__hasStandaloneModuleGraph();

namespace Bun {

// Mirrors `RawJsFrame` in src/pprof/heap.rs.
struct PprofJSFrame {
    const void* name;
    const void* url;
    uint32_t nameLength;
    uint32_t urlLength;
    uint32_t line;
    uint32_t column;
    uint32_t functionLine;
    uint32_t functionColumn;
    uint32_t chainIndex;
    uint8_t nameIs16Bit;
    uint8_t urlIs16Bit;
};

static void setString(const void*& characters, uint32_t& length, uint8_t& is16Bit, const WTF::String& string)
{
    auto* impl = string.impl();
    if (!impl || !impl->length())
        return;
    length = impl->length();
    is16Bit = !impl->is8Bit();
    characters = impl->is8Bit() ? static_cast<const void*>(impl->span8().data()) : static_cast<const void*>(impl->span16().data());
}

static void setLiteral(const void*& characters, uint32_t& length, ASCIILiteral literal)
{
    characters = literal.characters();
    length = static_cast<uint32_t>(literal.length());
}

static_assert(sizeof(PprofJSFrame) == 48 && offsetof(PprofJSFrame, chainIndex) == 40, "mirrors RawJsFrame in src/pprof/heap.rs");

static bool isJavaScriptPC(uintptr_t pc)
{
    if (JSC::isJITPC(std::bit_cast<void*>(pc)))
        return true;
    return pc >= std::bit_cast<uintptr_t>(&llintPCRangeStart) && pc <= std::bit_cast<uintptr_t>(&llintPCRangeEnd);
}

// Whether StackVisitor can read `top` itself, or only the frames that called it. While a call is
// being linked `vm.topCallFrame` is the callee's frame under construction: its code block slot is
// null, or the code block that is being prepared (no entrypoint yet), or what an earlier frame
// left there.
enum class TopFrame { Unusable,
    Skip,
    Read };
static TopFrame classifyTopFrame(JSC::VM& vm, JSC::CallFrame* top)
{
    using namespace JSC;
    // StackVisitor reads a wasm frame on top through `vm.maybeReturnPC`, which may be stale.
    if (top->callee().isNativeCallee())
        return TopFrame::Unusable;
    CodeBlock* codeBlock = top->codeBlock();
    if (!codeBlock) {
        JSCell* callee = top->callee().isCell() ? top->callee().asCell() : nullptr;
        auto* function = callee ? dynamicDowncast<JSFunction>(callee) : nullptr;
        return function && !function->isHostFunction() ? TopFrame::Skip : TopFrame::Read;
    }
    // The caller of malloc may hold the lock: then go without JavaScript frames.
    Lock& lock = vm.heap.codeBlockSet().getLock();
    if (!lock.tryLock())
        return TopFrame::Unusable;
    Locker locker { AdoptLock, lock };
    if (!vm.heap.codeBlockSet().contains(locker, codeBlock))
        return TopFrame::Unusable;
    if (codeBlock->jitType() == JITType::None)
        return TopFrame::Skip;
    if (JITCode::isOptimizingJIT(codeBlock->jitType()) && !codeBlock->canGetCodeOrigin(top->callSiteIndex()))
        return TopFrame::Skip;
    return TopFrame::Read;
}

} // namespace Bun

// `vm.topCallFrame` is stale after a JIT operation that does not record its frame: it is used
// only if it is a frame of the machine stack as just read and JIT or LLInt code runs in it.
extern "C" size_t Bun__pprof__captureJSFrames(JSC::VM* vm, const uintptr_t* framePointers, const uintptr_t* returnAddresses, size_t chainLength, Bun::PprofJSFrame* out, size_t capacity)
{
    using namespace JSC;
    CallFrame* top = vm->topCallFrame;
    if (!top || !vm->topEntryFrame || !capacity)
        return 0;

    size_t chainIndex = 0;
    while (chainIndex < chainLength && framePointers[chainIndex] != std::bit_cast<uintptr_t>(top))
        chainIndex++;
    // The pc that runs in frame `i` is the return address saved in frame `i - 1`.
    if (chainIndex == 0 || chainIndex == chainLength || !Bun::isJavaScriptPC(returnAddresses[chainIndex - 1]))
        return 0;
    const Bun::TopFrame topFrame = Bun::classifyTopFrame(*vm, top);
    if (topFrame == Bun::TopFrame::Unusable)
        return 0;

    // Code from a bytecode cache decodes its positions on first use, under a lock that the caller
    // of malloc may hold. A compiled executable has such code, its internal modules included.
    const bool positionsMayBeLazy = Bun__hasStandaloneModuleGraph();

    size_t count = 0;
    auto visit = [&](StackVisitor& visitor) -> IterationStatus {
        if (count == capacity)
            return IterationStatus::Done;
        auto callFrame = std::bit_cast<uintptr_t>(visitor->callFrame());
        while (chainIndex < chainLength && framePointers[chainIndex] != callFrame)
            chainIndex++;
        if (chainIndex == chainLength)
            return IterationStatus::Done;

        Bun::PprofJSFrame& frame = out[count++];
        frame = {};
        frame.chainIndex = static_cast<uint32_t>(chainIndex - 1);

        if (visitor->isNativeCalleeFrame()) {
            Bun::setLiteral(frame.name, frame.nameLength, visitor->isWasmFrame() ? "(wasm)"_s : "(native)"_s);
            return IterationStatus::Continue;
        }

        if (CodeBlock* codeBlock = visitor->codeBlock()) {
            ScriptExecutable* executable = codeBlock->ownerExecutable();
            if (executable->isFunctionExecutable()) {
                // Null while the name is only in a bytecode cache: decoding it allocates.
                if (auto* name = static_cast<FunctionExecutable*>(executable)->tryGetEcmaNameConcurrently())
                    Bun::setString(frame.name, frame.nameLength, frame.nameIs16Bit, name->string());
                if (!frame.nameLength)
                    Bun::setLiteral(frame.name, frame.nameLength, "(anonymous)"_s);
            } else if (executable->isEvalExecutable())
                Bun::setLiteral(frame.name, frame.nameLength, "(eval)"_s);
            else if (executable->isModuleProgramExecutable())
                Bun::setLiteral(frame.name, frame.nameLength, "(module)"_s);
            else
                Bun::setLiteral(frame.name, frame.nameLength, "(program)"_s);
            Bun::setString(frame.url, frame.urlLength, frame.urlIs16Bit, executable->sourceURL());
            frame.functionLine = static_cast<uint32_t>(std::max(executable->firstLine(), 0));
            frame.functionColumn = executable->startColumn();
            // The call site index can be stale: tiering up before the frame's first call.
            auto bytecodeIndex = visitor->bytecodeIndex();
            if (bytecodeIndex.offset() < codeBlock->instructions().size() && !positionsMayBeLazy && !executable->source().provider()->cachedBytecode()) {
                // Not `lineColumnForBytecodeIndex()`: that fills a cache, which allocates.
                auto lineColumn = codeBlock->expressionInfoForBytecodeIndex(bytecodeIndex).lineColumn;
                frame.line = lineColumn.line;
                frame.column = lineColumn.column;
            } else {
                frame.line = frame.functionLine;
                frame.column = frame.functionColumn;
            }
            return IterationStatus::Continue;
        }

        JSCell* callee = visitor->callee().isCell() ? visitor->callee().asCell() : nullptr;
        if (auto* function = callee ? dynamicDowncast<JSFunction>(callee) : nullptr) {
            if (function->isHostFunction())
                Bun::setString(frame.name, frame.nameLength, frame.nameIs16Bit, static_cast<NativeExecutable*>(function->executable())->name());
        }
        if (!frame.nameLength)
            Bun::setLiteral(frame.name, frame.nameLength, "(native)"_s);
        return IterationStatus::Continue;
    };
    StackVisitor::visit(top, *vm, visit, topFrame == Bun::TopFrame::Skip);
    return count;
}
