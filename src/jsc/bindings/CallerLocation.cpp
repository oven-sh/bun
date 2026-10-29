#include "root.h"
#include "CallerLocation.h"

#include "ErrorStackTrace.h"
#include "ZigGlobalObject.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/CodeBlock.h>
#include <JavaScriptCore/StackVisitor.h>
#include <wtf/text/OrdinalNumber.h>

namespace Bun {

CallerLocation callerLocation(JSC::VM& vm, JSC::CallFrame* callFrame)
{
    CallerLocation location;

    JSC::StackVisitor::visit(callFrame, vm, [&](JSC::StackVisitor& visitor) -> WTF::IterationStatus {
        if (Zig::isImplementationVisibilityPrivate(visitor))
            return WTF::IterationStatus::Continue;

        if (!visitor->hasLineAndColumnInfo())
            return WTF::IterationStatus::Continue;

        location.lineColumn = visitor->computeLineAndColumn();
        location.sourceURL = Zig::sourceURL(visitor);
        if (auto* codeBlock = visitor->codeBlock()) {
            if (auto* provider = codeBlock->source().provider())
                location.isStatic = provider->provenance() == JSC::SourceProvenance::Static;
        }
        return WTF::IterationStatus::Done;
    });

    return location;
}

void remapCallerLocation(JSC::JSGlobalObject* globalObject, CallerLocation& location)
{
    if (location.sourceURL.isEmpty() || !location.lineColumn.line)
        return;

    OwnedZigStackFrames remappedFrames(1);
    ZigStackFrame& remappedFrame = remappedFrames[0];
    remappedFrame.position.line_zero_based = OrdinalNumber::fromOneBasedInt(location.lineColumn.line).zeroBasedInt();
    remappedFrame.position.column_zero_based = OrdinalNumber::fromOneBasedInt(location.lineColumn.column).zeroBasedInt();
    remappedFrame.source_url = toStringRef(location.sourceURL);

    remappedFrames.remap(Bun::vm(globalObject));

    location.sourceURL = remappedFrame.source_url.toWTFString();
    location.lineColumn.line = OrdinalNumber::fromZeroBasedInt(remappedFrame.position.line_zero_based).oneBasedInt();
    location.lineColumn.column = OrdinalNumber::fromZeroBasedInt(remappedFrame.position.column_zero_based).oneBasedInt();
}

} // namespace Bun

extern "C" void Bun__getCallerSrcLocRaw(JSC::JSGlobalObject* globalObject, BunString* outSourceURL, unsigned* outLine, unsigned* outColumn, bool* outIsStatic)
{
    auto& vm = JSC::getVM(globalObject);
    auto location = Bun::callerLocation(vm, vm.topCallFrame);

    *outSourceURL = Bun::toStringRef(location.sourceURL);
    *outLine = location.lineColumn.line;
    *outColumn = location.lineColumn.column;
    *outIsStatic = location.isStatic;
}

extern "C" void Bun__remapCallerSrcLoc(JSC::JSGlobalObject* globalObject, const BunString* sourceURL, unsigned line, unsigned column, BunString* outSourceURL, unsigned* outLine, unsigned* outColumn)
{
    Bun::CallerLocation location { sourceURL->toWTFString(), { line, column } };
    Bun::remapCallerLocation(globalObject, location);

    *outSourceURL = Bun::toStringRef(location.sourceURL);
    *outLine = location.lineColumn.line;
    *outColumn = location.lineColumn.column;
}
