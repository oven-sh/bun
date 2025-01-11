#include "GeneratedJS2Native.h"
#include "root.h"

#include "ErrorStackTrace.h"
#include "ErrorCode.h"
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <cmath>

namespace Bun {
using namespace JSC;
using namespace ERR;
JSC_DEFINE_HOST_FUNCTION(jsFunctionUtilGetCallSites, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSValue firstArg = callFrame->argument(0);
    JSC::JSValue secondArg = callFrame->argument(1);

    size_t frameLimit = 10; // Default frame limit

    if (secondArg.isUndefined() && firstArg.isObject()) {
        secondArg = firstArg;
    } else if (!firstArg.isUndefined()) {
        if (!firstArg.isNumber()) {
            return ERR::INVALID_ARG_TYPE(scope, globalObject, "frameCount"_s, "number"_s, firstArg);
        }
        int64_t frameCount = firstArg.toInt32(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (frameCount < 1 || frameCount > 200) {
            return ERR::OUT_OF_RANGE(scope, globalObject, "frameCount"_s, "number"_s, firstArg);
        }
        frameLimit = frameCount;
    }

    // We don't do anything with the sourceMap option but we do the validation still.
    if (!secondArg.isUndefined()) {
        auto* optionsObj = secondArg.getObject();
        if (!optionsObj || JSC::isJSArray(optionsObj)) {
            return ERR::INVALID_ARG_TYPE(scope, globalObject, "options"_s, "object"_s, secondArg);
        }

        // Validate sourceMap option if present
        JSC::JSValue sourceMapValue = optionsObj->get(globalObject, JSC::Identifier::fromString(vm, "sourceMap"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!sourceMapValue.isUndefined() && !sourceMapValue.isBoolean()) {
            return ERR::INVALID_ARG_TYPE(scope, globalObject, "options.sourceMap"_s, "boolean"_s, sourceMapValue);
        }
    }

    // Create array to store call sites
    JSC::JSArray* callSites = JSC::constructEmptyArray(globalObject, nullptr);
    RETURN_IF_EXCEPTION(scope, {});

    // Get the stack trace
    Zig::JSCStackTrace stackTrace = Zig::JSCStackTrace::captureCurrentJSStackTrace(
        jsCast<Zig::GlobalObject*>(globalObject),
        callFrame,
        frameLimit + 1, // Add 1 to account for the current frame
        jsUndefined());

    // Convert stack frames to call site objects
    Identifier functionNameProperty = Identifier::fromString(vm, "functionName"_s);
    Identifier scriptNameProperty = Identifier::fromString(vm, "scriptName"_s);
    Identifier lineNumberProperty = Identifier::fromString(vm, "lineNumber"_s);
    Identifier columnProperty = vm.propertyNames->column;
    auto createFirstCallSite = [&]() -> JSObject* {
        auto* callSite = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
        auto& frame = stackTrace.frames()[0];
        // Set functionName
        JSC::JSString* functionName = frame.functionName();
        callSite->putDirect(vm, functionNameProperty, functionName ? functionName : jsEmptyString(vm));

        // Set scriptName (sourceURL)
        JSC::JSString* scriptName = frame.sourceURL();
        callSite->putDirect(vm, scriptNameProperty, scriptName ? scriptName : jsEmptyString(vm));

        // Get line and column numbers
        if (auto* positions = frame.getSourcePositions()) {
            // Line number (1-based)
            callSite->putDirect(vm, lineNumberProperty, JSC::jsNumber(positions->line.oneBasedInt()));

            // Column number (1-based)
            callSite->putDirect(vm, columnProperty, JSC::jsNumber(positions->column.oneBasedInt()));
        } else {
            // If no position info available, use 0
            callSite->putDirect(vm, lineNumberProperty, JSC::jsNumber(0));
            callSite->putDirect(vm, columnProperty, JSC::jsNumber(0));
        }

        return callSite;
    };

    switch (stackTrace.frames().size()) {
    case 0:
        break;
    case 1: {
        auto callSite = createFirstCallSite();
        callSites->push(globalObject, callSite);
        break;
    }
    default: {
        JSC::Structure* structure = nullptr;

        auto* firstCallSite = createFirstCallSite();
        structure = firstCallSite->structure();

        for (unsigned i = 1; i < stackTrace.frames().size(); ++i) {
            auto& frame = stackTrace.frames()[i];
            auto* callSite = JSC::constructEmptyObject(vm, structure);
            JSC::JSString* functionName = frame.functionName();

            JSC::JSString* scriptName = frame.sourceURL();
            callSite->putDirectOffset(vm, 0, functionName ? functionName : jsEmptyString(vm));
            callSite->putDirectOffset(vm, 1, scriptName ? scriptName : jsEmptyString(vm));
            if (auto* positions = frame.getSourcePositions()) {
                callSite->putDirectOffset(vm, 2, JSC::jsNumber(positions->line.oneBasedInt()));
                callSite->putDirectOffset(vm, 3, JSC::jsNumber(positions->column.oneBasedInt()));
            } else {
                callSite->putDirectOffset(vm, 2, JSC::jsNumber(0));
                callSite->putDirectOffset(vm, 3, JSC::jsNumber(0));
            }
            callSites->push(globalObject, callSite);
        }
    }
    }

    return JSC::JSValue::encode(callSites);
}
}
