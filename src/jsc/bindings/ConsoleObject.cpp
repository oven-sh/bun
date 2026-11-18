#include "root.h"

#include "JavaScriptCore/ArgList.h"
#include "headers.h"
#include "ConsoleObject.h"
#include "ZigGlobalObject.h"

#include <JavaScriptCore/ConsoleClient.h>
#include <JavaScriptCore/JSString.h>
#include <wtf/text/WTFString.h>

#include <JavaScriptCore/JSGlobalObjectInspectorController.h>

namespace Bun {
using namespace JSC;

static constexpr size_t maxPrintedArguments = 255;

void ConsoleObject::messageWithTypeAndLevel(MessageType type, MessageLevel level,
    JSC::JSGlobalObject* globalObject,
    const ArgList& arguments)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (globalObject->inspectable()) {
        globalObject->inspectorController().addConsoleMessage(globalObject, type, level, arguments.span());
        RETURN_IF_EXCEPTION(scope, );
    }

    if (type == MessageType::Table && !arguments.at(1).isUndefined() && !isJSArray(arguments.at(1))) [[unlikely]] {
        JSC::throwTypeError(globalObject, scope, "The \"properties\" argument must be an instance of Array."_s);
        return;
    }

    RELEASE_AND_RETURN(scope, Bun__ConsoleObject__messageWithTypeAndLevel(static_cast<uint32_t>(type), static_cast<uint32_t>(level), globalObject, arguments.data(), std::min(arguments.size(), maxPrintedArguments)));
}

void ConsoleObject::count(JSGlobalObject* globalObject, const String& label)
{
    auto input = Bun::toString(label);
    Bun__ConsoleObject__count(globalObject, &input);
}

void ConsoleObject::countReset(JSGlobalObject* globalObject, const String& label)
{
    auto input = Bun::toString(label);
    Bun__ConsoleObject__countReset(globalObject, &input);
}

void ConsoleObject::takeHeapSnapshot(JSC::JSGlobalObject* globalObject, const String&)
{
    Bun__ConsoleObject__takeHeapSnapshot(globalObject);
}
void ConsoleObject::time(JSGlobalObject*, const String& label)
{
    auto input = Bun::toString(label);
    Bun__ConsoleObject__time(&input);
}
void ConsoleObject::timeLog(JSGlobalObject* globalObject, const String& label, const ArgList& arguments)
{
    auto input = Bun::toString(label);
    Bun__ConsoleObject__timeLog(globalObject, &input, arguments.data(), std::min(arguments.size(), maxPrintedArguments));
}
void ConsoleObject::timeEnd(JSGlobalObject*, const String& label)
{
    auto input = Bun::toString(label);
    Bun__ConsoleObject__timeEnd(&input);
}

void ConsoleObject::profile(JSC::JSGlobalObject* globalObject, const String& title)
{
    if (globalObject->inspectable())
        globalObject->inspectorController().startConsoleProfile(globalObject, title);
}

void ConsoleObject::profileEnd(JSC::JSGlobalObject* globalObject, const String& title)
{
    if (globalObject->inspectable())
        globalObject->inspectorController().stopConsoleProfile(globalObject, title);
}

}
