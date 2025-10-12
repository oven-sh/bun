#include "V8StackTraceIterator.h"
#include "wtf/text/StringToIntegerConversion.h"

namespace Bun {

static WTF::StringView StringView_slice(WTF::StringView sv, unsigned start, unsigned end)
{
    return sv.substring(start, end - start);
}

V8StackTraceIterator::V8StackTraceIterator(WTF::StringView stack_)
    : stack(stack_)
{
}

bool V8StackTraceIterator::parseFrame(StackFrame& frame)
{

    if (offset >= stack.length())
        return false;

    auto start = stack.find("\n    at "_s, offset);

    if (start == WTF::notFound) {
        offset = stack.length();
        return false;
    }

    start += 8;
    auto end = stack.find("\n"_s, start);

    if (end == WTF::notFound) {
        offset = stack.length();
        end = offset;
    }

    if (start >= end || start == WTF::notFound) {
        return false;
    }

    WTF::StringView line = stack.substring(start, end - start);
    offset = end;

    // the proper singular spelling is parenthesis
    auto openingParentheses = line.reverseFind('(');
    auto closingParentheses = line.reverseFind(')');

    if (openingParentheses > closingParentheses)
        openingParentheses = WTF::notFound;

    if (openingParentheses == WTF::notFound || closingParentheses == WTF::notFound) {
        // Special case: "unknown" frames don't have parentheses but are valid
        // These appear in stack traces from certain error paths
        if (line == "unknown"_s) {
            frame.sourceURL = line;
            frame.functionName = WTF::StringView();
            return true;
        }

        // For any other frame without parentheses, terminate parsing as before
        offset = stack.length();
        return false;
    }

    auto lineInner = StringView_slice(line, openingParentheses + 1, closingParentheses);

    {
        auto marker1 = 0;
        auto marker2 = lineInner.find(':', marker1);

        if (marker2 == WTF::notFound) {
            frame.sourceURL = lineInner;
            goto done_block;
        }

        auto marker3 = lineInner.find(':', marker2 + 1);
        if (marker3 == WTF::notFound) {
            // /path/to/file.js:
            // /path/to/file.js:1
            // node:child_process
            // C:\Users\chloe\bun\file.js

            marker3 = lineInner.length();

            auto segment1 = StringView_slice(lineInner, marker1, marker2);
            auto segment2 = StringView_slice(lineInner, marker2 + 1, marker3);

            if (auto int1 = WTF::parseIntegerAllowingTrailingJunk<unsigned int>(segment2)) {
                frame.sourceURL = segment1;
                frame.lineNumber = WTF::OrdinalNumber::fromOneBasedInt(int1.value());
            } else {
                frame.sourceURL = StringView_slice(lineInner, marker1, marker3);
            }
            goto done_block;
        }

        // /path/to/file.js:1:
        // /path/to/file.js:1:2
        // node:child_process:1:2
        // C:\Users\chloe\bun\file.js:
        // C:\Users\chloe\bun\file.js:1
        // C:\Users\chloe\bun\file.js:1:2

        while (true) {
            auto newcolon = lineInner.find(':', marker3 + 1);
            if (newcolon == WTF::notFound)
                break;
            marker2 = marker3;
            marker3 = newcolon;
        }

        auto marker4 = lineInner.length();

        auto segment1 = StringView_slice(lineInner, marker1, marker2);
        auto segment2 = StringView_slice(lineInner, marker2 + 1, marker3);
        auto segment3 = StringView_slice(lineInner, marker3 + 1, marker4);

        if (auto int1 = WTF::parseIntegerAllowingTrailingJunk<unsigned int>(segment2)) {
            if (auto int2 = WTF::parseIntegerAllowingTrailingJunk<unsigned int>(segment3)) {
                frame.sourceURL = segment1;
                frame.lineNumber = WTF::OrdinalNumber::fromOneBasedInt(int1.value());
                frame.columnNumber = WTF::OrdinalNumber::fromOneBasedInt(int2.value());
            } else {
                frame.sourceURL = segment1;
                frame.lineNumber = WTF::OrdinalNumber::fromOneBasedInt(int1.value());
            }
        } else {
            if (auto int2 = WTF::parseIntegerAllowingTrailingJunk<unsigned int>(segment3)) {
                frame.sourceURL = StringView_slice(lineInner, marker1, marker3);
                frame.lineNumber = WTF::OrdinalNumber::fromOneBasedInt(int2.value());
            } else {
                frame.sourceURL = StringView_slice(lineInner, marker1, marker4);
            }
        }
    }
done_block:

    WTF::StringView functionName = line.substring(0, openingParentheses - 1);

    if (functionName == "global code"_s) {
        functionName = WTF::StringView();
        frame.isGlobalCode = true;
    }

    if (functionName.startsWith("async "_s)) {
        frame.isAsync = true;
        functionName = functionName.substring(6);
    }

    if (functionName.startsWith("new "_s)) {
        frame.isConstructor = true;
        functionName = functionName.substring(4);
    }

    if (functionName == "<anonymous>"_s) {
        functionName = WTF::StringView();
    }

    frame.functionName = functionName;

    return true;
}

void V8StackTraceIterator::forEachFrame(const WTF::Function<void(const V8StackTraceIterator::StackFrame&, bool&)> callback)
{
    bool stop = false;
    while (!stop) {
        StackFrame frame;
        if (!parseFrame(frame))
            break;
        callback(frame, stop);
    }
}

} // namespace Bun
