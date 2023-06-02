/**
 * How this works
 *
 * CommonJS modules are transpiled by Bun's transpiler to the following:
 *
 * (function (exports, require, module) { ... code })(exports, require, module)
 *
 * Then, at runtime, we create a JSCommonJSModule object.
 *
 * On this special object, we override the setter for the "exports" property in
 * a non-observable way (`static bool put ...`)
 *
 * When the setter is called, we set the internal "exports" property to the
 * value passed in and we also update the requireMap with the new value.
 *
 * After the CommonJS module is executed, we:
 * - Store the exports value in the requireMap (again)
 * - Loop through the keys of the exports object and re-export as ES Module
 *   named exports
 *
 * If an exception occurs, we remove the entry from the requireMap.
 *
 * We tried using a CustomGetterSetter instead of overriding `put`, but it led
 * to returning the getter itself
 *
 * How cyclical dependencies are handled
 *
 * Before executing the CommonJS module, we set the exports object in the
 * requireMap to an empty object. When the CommonJS module is required again, we
 * return the exports object from the requireMap. The values should be in sync
 * while the module is being executed, unless module.exports is re-assigned to a
 * different value. In that case, it will have a stale value.
 *
 */

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
#include <JavaScriptCore/JSModuleEnvironment.h>
#include <JavaScriptCore/SyntheticModuleRecord.h>

namespace Bun {
using namespace JSC;

static Structure* internalCreateCommonJSModuleStructure(
    Zig::GlobalObject* globalObject);

class JSCommonJSModule final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::OverridesPut;

    mutable JSC::WriteBarrier<JSC::Unknown> m_exportsObject;
    mutable JSC::WriteBarrier<JSC::JSString> m_id;

    void finishCreation(JSC::VM& vm, JSC::JSValue exportsObject, JSC::JSString* id)
    {
        Base::finishCreation(vm);
        ASSERT(inherits(vm, info()));
        m_exportsObject.set(vm, this, exportsObject);
        m_id.set(vm, this, id);

        this->putDirectOffset(
            vm,
            0,
            exportsObject);

        this->putDirectOffset(
            vm,
            1,
            id);

        this->putDirectOffset(
            vm,
            2,
            id);
    }

    static JSCommonJSModule* create(
        JSC::VM& vm,
        JSC::Structure* structure,
        JSC::JSValue exportsObject,
        JSC::JSString* id)
    {
        JSCommonJSModule* cell = new (NotNull, JSC::allocateCell<JSCommonJSModule>(vm)) JSCommonJSModule(vm, structure);
        cell->finishCreation(vm, exportsObject, id);
        return cell;
    }

    JSValue exportsObject()
    {
        return m_exportsObject.get();
    }

    JSValue id()
    {
        return m_id.get();
    }

    DECLARE_VISIT_CHILDREN;

    static bool put(
        JSC::JSCell* cell,
        JSC::JSGlobalObject* globalObject,
        JSC::PropertyName propertyName,
        JSC::JSValue value,
        JSC::PutPropertySlot& slot)
    {
        JSCommonJSModule* thisObject = jsCast<JSCommonJSModule*>(cell);
        ASSERT_GC_OBJECT_INHERITS(thisObject, info());
        auto& vm = globalObject->vm();
        auto throwScope = DECLARE_THROW_SCOPE(vm);

        auto* clientData = WebCore::clientData(vm);
        bool result = Base::put(thisObject, globalObject, propertyName, value, slot);
        if (result) {
            // Whenever you call module.exports = ... in a module, we need to:
            //
            // - Update the internal exports object
            // - Update the require map
            //
            if (propertyName == clientData->builtinNames().exportsPublicName()) {
                thisObject->m_exportsObject.set(vm, thisObject, value);
                Zig::GlobalObject* zigGlobalObject = jsCast<Zig::GlobalObject*>(globalObject);
                zigGlobalObject->requireMap()->set(globalObject, thisObject->id(), value);
                RETURN_IF_EXCEPTION(throwScope, false);
            }
        }

        RELEASE_AND_RETURN(throwScope, result);
    }

    static JSC::Structure* createStructure(
        JSC::JSGlobalObject* globalObject)
    {
        return internalCreateCommonJSModuleStructure(reinterpret_cast<Zig::GlobalObject*>(globalObject));
    }

    DECLARE_INFO;
    template<typename, SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSCommonJSModule, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForCommonJSModuleRecord.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForCommonJSModuleRecord = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForCommonJSModuleRecord.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForCommonJSModuleRecord = std::forward<decltype(space)>(space); });
    }

    JSCommonJSModule(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
};

Structure* createCommonJSModuleStructure(
    Zig::GlobalObject* globalObject)
{
    return JSCommonJSModule::createStructure(globalObject);
}

static Structure* internalCreateCommonJSModuleStructure(
    Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    JSC::Structure* structure = JSC::Structure::create(
        vm,
        globalObject,
        globalObject->objectPrototype(),
        JSC::TypeInfo(JSC::ObjectType, JSCommonJSModule::StructureFlags),
        JSCommonJSModule::info(),
        JSC::NonArray,
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
        JSC::Identifier::fromString(vm, "filename"_s),
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

template<typename Visitor>
void JSCommonJSModule::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSCommonJSModule* thisObject = jsCast<JSCommonJSModule*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_exportsObject);
    visitor.append(thisObject->m_id);
}

DEFINE_VISIT_CHILDREN(JSCommonJSModule);
const JSC::ClassInfo JSCommonJSModule::s_info = { "Module"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCommonJSModule) };

JSCommonJSModule* createCommonJSModuleObject(
    Zig::GlobalObject* globalObject,
    const WTF::String& sourceURL,
    JSC::JSValue exportsObjectValue,
    JSC::JSValue requireFunctionValue)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* jsSourceURL = JSC::jsString(vm, sourceURL);

    JSCommonJSModule* moduleObject = JSCommonJSModule::create(
        vm,
        globalObject->CommonJSModuleObjectStructure(),
        exportsObjectValue,
        jsSourceURL);

    moduleObject->putDirectOffset(
        vm,
        3,
        requireFunctionValue);

    return moduleObject;
}

static bool canPerformFastEnumeration(Structure* s)
{
    if (s->typeInfo().overridesGetOwnPropertySlot())
        return false;
    if (s->typeInfo().overridesAnyFormOfGetOwnPropertyNames())
        return false;
    if (hasIndexedProperties(s->indexingType()))
        return false;
    if (s->hasAnyKindOfGetterSetterProperties())
        return false;
    if (s->isUncacheableDictionary())
        return false;
    if (s->hasUnderscoreProtoPropertyExcludingOriginalProto())
        return false;
    return true;
}

JSC::JSValue evaluateCommonJSModule(
    Zig::GlobalObject* globalObject,
    JSC::SyntheticModuleRecord* syntheticModuleRecord,
    EvalExecutable* executable)
{
    auto sourceURL = syntheticModuleRecord->moduleKey().string().string();
    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* requireMapKey = jsString(vm, sourceURL);

    unsigned int exportCount = syntheticModuleRecord->exportEntries().size();
    JSC::JSObject* exportsObject = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype());

    auto index = sourceURL.reverseFind('/', sourceURL.length());
    JSString* dirname = jsEmptyString(vm);
    JSString* filename = requireMapKey;
    if (index != WTF::notFound) {
        dirname = JSC::jsSubstring(globalObject, requireMapKey, 0, index);
    }

    globalObject->requireMap()->set(globalObject, requireMapKey, exportsObject);

    JSC::Structure* scopeExtensionObjectStructure = globalObject->commonJSFunctionArgumentsStructure();
    JSC::JSObject* scopeExtensionObject = JSC::constructEmptyObject(
        vm,
        scopeExtensionObjectStructure);

    auto* requireFunction = Zig::ImportMetaObject::createRequireFunction(vm, globalObject, sourceURL);

    auto* moduleObject = createCommonJSModuleObject(globalObject,
        sourceURL,
        exportsObject,
        requireFunction);

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
        dirname);

    scopeExtensionObject->putDirectOffset(
        vm,
        3,
        filename);

    scopeExtensionObject->putDirectOffset(
        vm,
        4,
        requireFunction);

    if (UNLIKELY(throwScope.exception())) {
        globalObject->requireMap()->remove(globalObject, requireMapKey);
        throwScope.release();
        return {};
    }

    auto catchScope = DECLARE_CATCH_SCOPE(vm);

    // Where the magic happens.
    //
    // A `with` scope is created containing { module, exports, require }.
    // We eval() the CommonJS module code
    // with that scope.
    //
    // Doing it that way saves us a roundtrip through C++ <> JS.
    //
    //      Sidenote: another implementation could use
    //      FunctionExecutable. It looks like there are lots of arguments
    //      to pass to that and it isn't used directly much, so that
    //      seems harder to do correctly.
    {
        JSWithScope* withScope = JSWithScope::create(vm, globalObject, globalObject->globalScope(), scopeExtensionObject);
        auto* globalExtension = globalObject->globalScopeExtension();
        globalObject->setGlobalScopeExtension(withScope);
        vm.interpreter.executeEval(executable, globalObject, globalObject->globalScope());
        globalObject->setGlobalScopeExtension(globalExtension);
        syntheticModuleRecord->setUserValue(vm, jsUndefined());
    }

    if (throwScope.exception()) {
        globalObject->requireMap()->remove(globalObject, requireMapKey);
        throwScope.release();
        return {};
    }

    JSValue result = moduleObject->exportsObject();

    globalObject->requireMap()->set(globalObject, requireMapKey, result);

    // The developer can do something like:
    //
    //   Object.defineProperty(module, 'exports', {get: getter})
    //
    // In which case, the exports object is now a GetterSetter object.
    //
    // We can't return a GetterSetter object to ESM code, so we need to call it.
    if (!result.isEmpty() && (result.isGetterSetter() || result.isCustomGetterSetter())) {
        auto* clientData = WebCore::clientData(vm);

        // TODO: is there a faster way to call these getters? We shouldn't need to do a full property lookup.
        //
        // we use getIfPropertyExists just incase a pathological devleoper did:
        //
        //   - Object.defineProperty(module, 'exports', {get: getter})
        //   - delete module.exports
        //
        result = moduleObject->getIfPropertyExists(globalObject, clientData->builtinNames().exportsPublicName());

        if (UNLIKELY(throwScope.exception())) {
            // Unlike getters on properties of the exports object
            // When the exports object itself is a getter and it throws
            // There's not a lot we can do
            // so we surface that error
            globalObject->requireMap()->remove(globalObject, requireMapKey);
            throwScope.release();
        }
    }

    auto* moduleEnvironment = syntheticModuleRecord->moduleEnvironment();

    if (result && result.isObject()) {
        auto* jsExportsObject = jsCast<JSC::JSObject*>(result);
        auto defaultKeyword = vm.propertyNames->defaultKeyword;
        for (auto& exportEntry : syntheticModuleRecord->exportEntries()) {
            PropertyName exportName = exportEntry.value.localName;

            if (exportName == defaultKeyword) {
                continue;
            } else if (exportName.isSymbol())
                continue;

            JSValue exportValue = jsExportsObject->getIfPropertyExists(globalObject, exportName);
            if (UNLIKELY(catchScope.exception())) {
                catchScope.clearException();
                continue;
            }

            constexpr bool shouldThrowReadOnlyError = false;
            constexpr bool ignoreReadOnlyErrors = true;
            bool putResult = false;
            symbolTablePutTouchWatchpointSet(moduleEnvironment, globalObject, exportName, exportValue, shouldThrowReadOnlyError, ignoreReadOnlyErrors, putResult);
        }
    }

    if (result) {
        constexpr bool shouldThrowReadOnlyError = false;
        constexpr bool ignoreReadOnlyErrors = true;
        bool putResult = false;
        PropertyName exportName = vm.propertyNames->defaultKeyword;
        JSValue exportValue = result;
        symbolTablePutTouchWatchpointSet(moduleEnvironment, globalObject, exportName, exportValue, shouldThrowReadOnlyError, ignoreReadOnlyErrors, putResult);
    }

    {
        constexpr bool shouldThrowReadOnlyError = false;
        constexpr bool ignoreReadOnlyErrors = true;
        bool putResult = false;
        PropertyName exportName = Identifier::fromUid(vm.symbolRegistry().symbolForKey("module"_s));
        JSValue exportValue = moduleObject;
        symbolTablePutTouchWatchpointSet(moduleEnvironment, globalObject, exportName, exportValue, shouldThrowReadOnlyError, ignoreReadOnlyErrors, putResult);
    }

    return {};
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
                JSC::MarkedArgumentBuffer& exportValues) -> JSValue {
                Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
                auto sourceCodeString = Zig::toString(source.source_code);
                auto& vm = globalObject->vm();

                JSC::SourceCode inputSource(
                    JSC::StringSourceProvider::create(sourceCodeString,
                        JSC::SourceOrigin(WTF::URL::fileURLWithFileSystemPath(sourceURL)),
                        sourceURL, TextPosition()));

                auto throwScope = DECLARE_THROW_SCOPE(vm);
                auto* executable = JSC::DirectEvalExecutable::create(
                    globalObject, inputSource, DerivedContextType::None, NeedsClassFieldInitializer::No, PrivateBrandRequirement::None,
                    false, false, EvalContextType::None, nullptr, nullptr, ECMAMode::sloppy());

                if (UNLIKELY(!executable && !throwScope.exception())) {
                    throwSyntaxError(globalObject, throwScope, "Failed to create CommonJS module"_s);
                }

                if (UNLIKELY(throwScope.exception())) {
                    throwScope.release();
                    return jsUndefined();
                }

                size_t exportNamesLen = source.commonJSExportsLen > 0 && source.commonJSExportsLen < std::numeric_limits<uint32_t>::max() ? source.commonJSExportsLen : 0;
                exportNames.reserveCapacity(exportNamesLen + 3);
                exportValues.ensureCapacity(exportNamesLen + 3);

                exportNames.append(vm.propertyNames->defaultKeyword);
                exportValues.append(jsUndefined());

                // This exists to tell ImportMetaObject.ts that this is a CommonJS module.
                exportNames.append(Identifier::fromUid(vm.symbolRegistry().symbolForKey("CommonJS"_s)));
                exportValues.append(jsNumber(0));

                // This exists to tell ImportMetaObject.ts that this is a CommonJS module.
                exportNames.append(Identifier::fromUid(vm.symbolRegistry().symbolForKey("module"_s)));
                exportValues.append(jsUndefined());

                for (size_t i = 0; i < exportNamesLen; i++) {
                    auto str = Zig::toStringCopy(source.commonJSExports[i]);
                    exportNames.append(Identifier::fromString(vm, str));
                    exportValues.append(jsUndefined());
                }
                vm.heap.collectAsync();
                return executable;
            },
            SourceOrigin(WTF::URL::fileURLWithFileSystemPath(sourceURL)),
            sourceURL));
}

}