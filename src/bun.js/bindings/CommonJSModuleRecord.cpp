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
#include <JavaScriptCore/GetterSetter.h>
#include "ZigSourceProvider.h"

namespace Bun {
using namespace JSC;

class JSCommonJSModule final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::OverridesPut;

    mutable JSC::WriteBarrier<JSC::Unknown> m_exportsObject;
    mutable JSC::WriteBarrier<JSC::JSString> m_id;

    void finishCreation(JSC::VM& vm, JSC::JSValue exportsObject, JSC::JSString* id, JSC::JSString* filename, JSC::JSString* dirname, JSC::JSValue requireFunction)
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
            filename);

        this->putDirectOffset(
            vm,
            3,
            jsBoolean(false));

        this->putDirectOffset(
            vm,
            4,
            dirname);

        this->putDirectOffset(
            vm,
            5,
            jsUndefined());
    }

    static JSC::Structure* createStructure(
        JSC::JSGlobalObject* globalObject)
    {
        auto& vm = globalObject->vm();
        JSC::Structure* structure = JSC::Structure::create(
            vm,
            globalObject,
            globalObject->objectPrototype(),
            JSC::TypeInfo(JSC::ObjectType, JSCommonJSModule::StructureFlags),
            JSCommonJSModule::info(),
            JSC::NonArray,
            6);

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
            JSC::Identifier::fromString(vm, "loaded"_s),
            0,
            offset);

        structure = structure->addPropertyTransition(
            vm,
            structure,
            JSC::Identifier::fromString(vm, "path"_s),
            0,
            offset);

        structure = structure->addPropertyTransition(
            vm,
            structure,
            JSC::Identifier::fromString(vm, "require"_s),
            0,
            offset);

        return structure;
    }

    static JSCommonJSModule* create(
        JSC::VM& vm,
        JSC::Structure* structure,
        JSC::JSValue exportsObject,
        JSC::JSString* id,
        JSC::JSString* filename,
        JSC::JSString* dirname,
        JSC::JSValue requireFunction)
    {
        JSCommonJSModule* cell = new (NotNull, JSC::allocateCell<JSCommonJSModule>(vm)) JSCommonJSModule(vm, structure);
        cell->finishCreation(vm, exportsObject, id, filename, dirname, requireFunction);
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

        auto& vm = globalObject->vm();
        auto* clientData = WebCore::clientData(vm);
        auto throwScope = DECLARE_THROW_SCOPE(vm);

        if (propertyName == clientData->builtinNames().exportsPublicName()) {
            JSCommonJSModule* thisObject = jsCast<JSCommonJSModule*>(cell);
            ASSERT_GC_OBJECT_INHERITS(thisObject, info());

            // It will crash if we attempt to assign Object.defineProperty() result to a JSMap*.
            if (UNLIKELY(slot.thisValue() != thisObject))
                RELEASE_AND_RETURN(throwScope, JSObject::definePropertyOnReceiver(globalObject, propertyName, value, slot));

            JSValue prevValue = thisObject->m_exportsObject.get();

            // TODO: refactor this to not go through ESM path and we don't need to do this check.
            // IF we do this on every call, it causes GC to happen in a place that it may not be able to.
            // This breaks loading Bluebird in some cases, for example.
            // We need to update the require map "live" because otherwise the code in Discord.js will break
            // The bug is something to do with exception handling which causes GC to happen in the error path and then boom.
            if (prevValue != value && (!prevValue.isCell() || !value.isCell() || prevValue.asCell()->type() != value.asCell()->type())) {
                jsCast<Zig::GlobalObject*>(globalObject)->requireMap()->set(globalObject, thisObject->id(), value);
            }

            thisObject->m_exportsObject.set(vm, thisObject, value);
        }

        RELEASE_AND_RETURN(throwScope, Base::put(cell, globalObject, propertyName, value, slot));
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

JSValue evaluateCommonJSModule(
    Zig::GlobalObject* globalObject,
    Ref<Zig::SourceProvider> sourceProvider,
    const WTF::String& sourceURL,
    ResolvedSource source)
{
    auto& vm = globalObject->vm();

    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* requireMapKey = jsString(vm, sourceURL);

    JSC::JSObject* exportsObject = source.commonJSExportsLen < 64
        ? JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), source.commonJSExportsLen)
        : JSC::constructEmptyObject(globalObject, globalObject->objectPrototype());
    auto index = sourceURL.reverseFind('/', sourceURL.length());
    JSString* dirname = jsEmptyString(vm);
    JSString* filename = requireMapKey;
    if (index != WTF::notFound) {
        dirname = JSC::jsSubstring(globalObject, requireMapKey, 0, index);
    }

    globalObject->requireMap()->set(globalObject, requireMapKey, exportsObject);
    auto* requireFunction = Zig::ImportMetaObject::createRequireFunction(vm, globalObject, sourceURL);

    JSC::SourceCode inputSource(
        WTFMove(sourceProvider));

    auto* moduleObject = JSCommonJSModule::create(
        vm,
        globalObject->CommonJSModuleObjectStructure(),
        exportsObject,
        requireMapKey, filename, dirname, requireFunction);

    if (UNLIKELY(throwScope.exception())) {
        globalObject->requireMap()->remove(globalObject, requireMapKey);
        RELEASE_AND_RETURN(throwScope, JSValue());
    }

    JSC::Structure* thisObjectStructure = globalObject->commonJSFunctionArgumentsStructure();
    JSC::JSObject* thisObject = JSC::constructEmptyObject(
        vm,
        thisObjectStructure);
    thisObject->putDirectOffset(
        vm,
        0,
        moduleObject);

    thisObject->putDirectOffset(
        vm,
        1,
        exportsObject);

    thisObject->putDirectOffset(
        vm,
        2,
        dirname);

    thisObject->putDirectOffset(
        vm,
        3,
        filename);

    thisObject->putDirectOffset(
        vm,
        4,
        requireFunction);

    {
        WTF::NakedPtr<Exception> exception;
        globalObject->m_BunCommonJSModuleValue.set(vm, globalObject, thisObject);
        JSC::evaluate(globalObject, inputSource, globalObject->globalThis(), exception);

        if (exception.get()) {
            throwScope.throwException(globalObject, exception->value());
            exception.clear();
            RELEASE_AND_RETURN(throwScope, JSValue());
        }
    }

    if (UNLIKELY(throwScope.exception())) {
        globalObject->requireMap()->remove(globalObject, requireMapKey);
        RELEASE_AND_RETURN(throwScope, JSValue());
    }

    JSValue result = moduleObject->exportsObject();

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
        if (result.isGetterSetter()) {
            JSC::GetterSetter* getter = jsCast<JSC::GetterSetter*>(result);
            result = getter->callGetter(globalObject, moduleObject);
        } else {
            result = moduleObject->getIfPropertyExists(globalObject, clientData->builtinNames().exportsPublicName());
        }

        if (UNLIKELY(throwScope.exception())) {
            // Unlike getters on properties of the exports object
            // When the exports object itself is a getter and it throws
            // There's not a lot we can do
            // so we surface that error
            globalObject->requireMap()->remove(globalObject, requireMapKey);
            RELEASE_AND_RETURN(throwScope, JSValue());
        }
    }

    globalObject->requireMap()->set(globalObject, requireMapKey, result);

    return result;
}

JSC::SourceCode createCommonJSModule(
    Zig::GlobalObject* globalObject,
    ResolvedSource source)
{
    auto sourceURL = Zig::toStringCopy(source.source_url);
    auto sourceProvider = Zig::SourceProvider::create(globalObject, source, JSC::SourceProviderSourceType::Program);

    return JSC::SourceCode(
        JSC::SyntheticSourceProvider::create(
            [source, sourceProvider = WTFMove(sourceProvider), sourceURL](JSC::JSGlobalObject* globalObject,
                JSC::Identifier moduleKey,
                Vector<JSC::Identifier, 4>& exportNames,
                JSC::MarkedArgumentBuffer& exportValues) -> void {
                JSValue result = evaluateCommonJSModule(
                    jsCast<Zig::GlobalObject*>(globalObject),
                    WTFMove(sourceProvider),
                    sourceURL,
                    source);

                if (!result) {
                    return;
                }

                auto& vm = globalObject->vm();

                exportNames.append(vm.propertyNames->defaultKeyword);
                exportValues.append(result);

                // This exists to tell ImportMetaObject.ts that this is a CommonJS module.
                exportNames.append(Identifier::fromUid(vm.symbolRegistry().symbolForKey("CommonJS"_s)));
                exportValues.append(jsNumber(0));

                if (result.isObject()) {
                    DeferGCForAWhile deferGC(vm);
                    auto* exports = asObject(result);

                    auto* structure = exports->structure();
                    uint32_t size = structure->inlineSize() + structure->outOfLineSize();
                    exportNames.reserveCapacity(size + 2);
                    exportValues.ensureCapacity(size + 2);

                    if (canPerformFastEnumeration(structure)) {
                        exports->structure()->forEachProperty(vm, [&](const PropertyTableEntry& entry) -> bool {
                            auto key = entry.key();
                            if (key->isSymbol() || key == vm.propertyNames->defaultKeyword || entry.attributes() & PropertyAttribute::DontEnum)
                                return true;

                            exportNames.append(Identifier::fromUid(vm, key));

                            JSValue value = exports->getDirect(entry.offset());

                            exportValues.append(value);
                            return true;
                        });
                    } else {
                        auto catchScope = DECLARE_CATCH_SCOPE(vm);
                        JSC::PropertyNameArray properties(vm, JSC::PropertyNameMode::Strings, JSC::PrivateSymbolMode::Exclude);
                        exports->methodTable()->getOwnPropertyNames(exports, globalObject, properties, DontEnumPropertiesMode::Exclude);
                        if (catchScope.exception()) {
                            catchScope.clearExceptionExceptTermination();
                            return;
                        }

                        for (auto property : properties) {
                            if (UNLIKELY(property.isEmpty() || property.isNull() || property.isPrivateName() || property.isSymbol()))
                                continue;

                            // ignore constructor
                            if (property == vm.propertyNames->constructor || property == vm.propertyNames->defaultKeyword)
                                continue;

                            JSC::PropertySlot slot(exports, PropertySlot::InternalMethodType::Get);
                            if (!exports->getPropertySlot(globalObject, property, slot))
                                continue;

                            exportNames.append(property);

                            JSValue getterResult = slot.getValue(globalObject, property);

                            // If it throws, we keep them in the exports list, but mark it as undefined
                            // This is consistent with what Node.js does.
                            if (catchScope.exception()) {
                                catchScope.clearException();
                                getterResult = jsUndefined();
                            }

                            exportValues.append(getterResult);
                        }
                    }
                }
            },
            SourceOrigin(WTF::URL::fileURLWithFileSystemPath(sourceURL)),
            sourceURL));
}

}