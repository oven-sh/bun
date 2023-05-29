#include "root.h"
#include "headers-handwritten.h"
#include "ZigGlobalObject.h"
#include "JavaScriptCore/JSSourceCode.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/JSValueInternal.h"
#include "JavaScriptCore/JSVirtualMachineInternal.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/OptionsList.h"
#include "JavaScriptCore/ParserError.h"
#include "JavaScriptCore/ScriptExecutable.h"
#include "JavaScriptCore/SourceOrigin.h"
#include "JavaScriptCore/StackFrame.h"
#include "JavaScriptCore/StackVisitor.h"
#include "BunClientData.h"
#include "JavaScriptCore/Identifier.h"
#include "ImportMetaObject.h"

#include "JavaScriptCore/TypedArrayInlines.h"
#include "JavaScriptCore/PropertyNameArray.h"
#include "JavaScriptCore/JSWeakMap.h"
#include "JavaScriptCore/JSWeakMapInlines.h"
#include "JavaScriptCore/JSWithScope.h"

#include <JavaScriptCore/DFGAbstractHeap.h>
#include <JavaScriptCore/Completion.h>
#include <JavaScriptCore/JSMap.h>

#include <JavaScriptCore/JSMapInlines.h>

namespace Bun {
using namespace JSC;

JSC::Structure* createCommonJSModuleStructure(
    Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    JSC::Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(
        globalObject,
        globalObject->objectPrototype(),
        4);

    JSC::PropertyOffset offset;
    auto clientData = WebCore::clientData(vm);

    structure = structure->addPropertyTransition(
        vm,
        structure,
        JSC::Identifier::fromString(vm, "exports"_s),
        0,
        offset);

    structure = structure->addPropertyTransition(
        vm,
        structure,
        JSC::Identifier::fromString(vm, "id"_s),
        0,
        offset);

    structure = structure->addPropertyTransition(
        vm,
        structure,
        JSC::Identifier::fromString(vm, "fileName"_s),
        0,
        offset);

    structure = structure->addPropertyTransition(
        vm,
        structure,
        JSC::Identifier::fromString(vm, "require"_s),
        JSC::PropertyAttribute::Builtin | JSC::PropertyAttribute::Function | 0,
        offset);

    return structure;
}

JSC::JSObject* createCommonJSModuleObject(
    Zig::GlobalObject* globalObject,
    const ResolvedSource& source, const WTF::String& sourceURL, JSC::JSValue exportsObjectValue, JSC::JSValue requireFunctionValue)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSObject* moduleObject = JSC::constructEmptyObject(
        vm,
        globalObject->CommonJSModuleObjectStructure());

    RETURN_IF_EXCEPTION(scope, nullptr);

    moduleObject->putDirectOffset(
        vm,
        0,
        exportsObjectValue);

    auto* jsSourceURL = JSC::jsString(vm, sourceURL);
    moduleObject->putDirectOffset(
        vm,
        1,
        jsSourceURL);

    moduleObject->putDirectOffset(
        vm,
        2,
        // TODO: filename should be substring
        jsSourceURL);

    moduleObject->putDirectOffset(
        vm,
        3,
        requireFunctionValue);

    return moduleObject;
}

JSC::SourceCode createCommonJSModule(
    Zig::GlobalObject* globalObject,
    ResolvedSource source)
{

    auto sourceURL = Zig::toStringCopy(source.source_url);

    return JSC::SourceCode(
        JSC::SyntheticSourceProvider::create(
            [source, sourceURL](JSC::JSGlobalObject* lexicalGlobalObject,
                JSC::Identifier moduleKey,
                Vector<JSC::Identifier, 4>& exportNames,
                JSC::MarkedArgumentBuffer& exportValues) -> void {
                Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
                auto& vm = globalObject->vm();
                auto throwScope = DECLARE_THROW_SCOPE(vm);
                auto sourceCodeString = Zig::toString(source.source_code);
                JSC::SourceCode inputSource(
                    JSC::StringSourceProvider::create(sourceCodeString,
                        JSC::SourceOrigin(WTF::URL::fileURLWithFileSystemPath(sourceURL)),
                        sourceURL, TextPosition()));

                JSC::JSObject* scopeExtensionObject = JSC::constructEmptyObject(
                    vm,
                    globalObject->commonJSFunctionArgumentsStructure());

                auto* requireFunction = Zig::ImportMetaObject::createRequireFunction(vm, globalObject, sourceURL);

                JSC::JSObject* exportsObject = source.commonJSExportsLen < 64
                    ? JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), source.commonJSExportsLen)
                    : JSC::constructEmptyObject(globalObject, globalObject->objectPrototype());
                auto* moduleObject = createCommonJSModuleObject(globalObject, source, sourceURL, exportsObject, requireFunction);
                scopeExtensionObject->putDirectOffset(
                    vm,
                    0,
                    moduleObject);

                scopeExtensionObject->putDirectOffset(
                    vm,
                    1,
                    exportsObject);

                scopeExtensionObject->putDirectOffset(
                    vm,
                    2,
                    requireFunction);

                auto* executable = JSC::DirectEvalExecutable::create(
                    globalObject, inputSource, DerivedContextType::None, NeedsClassFieldInitializer::No, PrivateBrandRequirement::None,
                    false, false, EvalContextType::None, nullptr, nullptr, ECMAMode::sloppy());

                auto* contextScope = JSC::JSWithScope::create(vm, globalObject, globalObject->globalScope(), scopeExtensionObject);
                auto* requireMapKey = jsString(vm, sourceURL);
                if (JSValue current = globalObject->requireMap()->get(globalObject, requireMapKey)) {
                    globalObject->requireMap()->set(globalObject, requireMapKey, exportsObject);
                }

                auto catchScope = DECLARE_CATCH_SCOPE(vm);
                vm.interpreter.executeEval(executable, globalObject, contextScope);
                if (UNLIKELY(catchScope.exception())) {
                    auto returnedException = catchScope.exception();
                    catchScope.clearException();
                    JSC::throwException(globalObject, throwScope, returnedException);
                }

                if (throwScope.exception())
                    return;

                exportNames.append(vm.propertyNames->defaultKeyword);
                JSValue result = moduleObject->getDirect(0);
                globalObject->requireMap()->set(globalObject, requireMapKey, result);
                exportValues.append(result);
                exportNames.append(Identifier::fromUid(vm.symbolRegistry().symbolForKey("CommonJS"_s)));
                exportValues.append(jsNumber(0));

                if (result.isObject()) {
                    auto* exports = asObject(result);
                    JSC::PropertyNameArray properties(vm, JSC::PropertyNameMode::StringsAndSymbols, JSC::PrivateSymbolMode::Exclude);
                    exports->methodTable()->getOwnPropertyNames(exports, globalObject, properties, DontEnumPropertiesMode::Include);
                    if (throwScope.exception())
                        return;

                    for (auto propertyName : properties) {
                        if (propertyName == vm.propertyNames->defaultKeyword)
                            continue;
                        exportNames.append(propertyName);
                        exportValues.append(exports->get(globalObject, propertyName));
                        if (throwScope.exception())
                            return;
                    }
                }
            },
            SourceOrigin(WTF::URL::fileURLWithFileSystemPath(sourceURL)),
            sourceURL));
}

}