#pragma once

#include "wtf/text/StringView.h"
#include "wtf/text/WTFString.h"
#include "wtf/text/OrdinalNumber.h"
#include "wtf/Function.h"

namespace Bun {

class V8StackTraceIterator {
public:
    class StackFrame {
    public:
        WTF::StringView functionName {};
        WTF::StringView sourceURL {};
        WTF::OrdinalNumber lineNumber = WTF::OrdinalNumber::fromZeroBasedInt(0);
        WTF::OrdinalNumber columnNumber = WTF::OrdinalNumber::fromZeroBasedInt(0);

        bool isConstructor = false;
        bool isGlobalCode = false;
        bool isAsync = false;
    };

    V8StackTraceIterator(WTF::StringView stack_);

    bool parseFrame(StackFrame& frame);
    void forEachFrame(const WTF::Function<void(const V8StackTraceIterator::StackFrame&, bool&)> callback);

private:
    WTF::StringView stack;
    unsigned int offset = 0;
};

} // namespace Bun
