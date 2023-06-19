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
#include "ModuleLoader.h"
#include <JavaScriptCore/JSMap.h>

#include <JavaScriptCore/JSMapInlines.h>
#include <JavaScriptCore/GetterSetter.h>
#include "ZigSourceProvider.h"
#include "JavaScriptCore/FunctionPrototype.h"
#include "CommonJSModuleRecord.h"
#include <JavaScriptCore/JSModuleNamespaceObject.h>

namespace JSC {

class IndirectEvalExecutable final : public EvalExecutable {
public:
    static IndirectEvalExecutable* tryCreate(JSGlobalObject*, const SourceCode&, DerivedContextType, bool isArrowFunctionContext, EvalContextType);
    static IndirectEvalExecutable* create(JSGlobalObject*, const SourceCode&, DerivedContextType, bool isArrowFunctionContext, EvalContextType, NakedPtr<JSObject>&);

private:
    template<typename ErrorHandlerFunctor>
    inline static IndirectEvalExecutable* createImpl(JSGlobalObject*, const SourceCode&, DerivedContextType, bool isArrowFunctionContext, EvalContextType, ErrorHandlerFunctor);

    IndirectEvalExecutable(JSGlobalObject*, const SourceCode&, DerivedContextType, bool isArrowFunctionContext, EvalContextType);
};

static_assert(sizeof(IndirectEvalExecutable) == sizeof(EvalExecutable));

} // namespace JSC

namespace Bun {
using namespace JSC;

JSC_DECLARE_HOST_FUNCTION(jsFunctionRequireCommonJS);

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

JSC_DECLARE_HOST_FUNCTION(jsFunctionEvaluateCommonJS);

JSC_DEFINE_HOST_FUNCTION(requireResolvePathsFunction, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    return JSValue::encode(JSC::constructEmptyArray(globalObject, nullptr, 0));
}

static const HashTableValue RequireResolveFunctionPrototypeValues[] = {
    { "paths"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, requireResolvePathsFunction, 1 } },
};

class RequireResolveFunctionPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static RequireResolveFunctionPrototype* create(
        JSC::JSGlobalObject* globalObject)
    {
        auto& vm = globalObject->vm();

        auto* structure = RequireResolveFunctionPrototype::createStructure(vm, globalObject, globalObject->functionPrototype());
        RequireResolveFunctionPrototype* prototype = new (NotNull, JSC::allocateCell<RequireResolveFunctionPrototype>(vm)) RequireResolveFunctionPrototype(vm, structure);
        prototype->finishCreation(vm);
        return prototype;
    }

    DECLARE_INFO;

    RequireResolveFunctionPrototype(
        JSC::VM& vm,
        JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.functionSpace();
    }

    void finishCreation(JSC::VM& vm);
};

static const HashTableValue RequireFunctionPrototypeValues[] = {
    { "cache"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, Zig::jsRequireCacheGetter, Zig::jsRequireCacheSetter } },
};

class RequireFunctionPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static RequireFunctionPrototype* create(
        JSC::JSGlobalObject* globalObject)
    {
        auto& vm = globalObject->vm();

        auto* structure = RequireFunctionPrototype::createStructure(vm, globalObject, globalObject->functionPrototype());
        RequireFunctionPrototype* prototype = new (NotNull, JSC::allocateCell<RequireFunctionPrototype>(vm)) RequireFunctionPrototype(vm, structure);
        prototype->finishCreation(vm);

        JSFunction* resolveFunction = JSFunction::create(vm, moduleRequireResolveCodeGenerator(vm), globalObject->globalScope(), JSFunction::createStructure(vm, globalObject, RequireResolveFunctionPrototype::create(globalObject)));
        prototype->putDirect(vm, JSC::Identifier::fromString(vm, "resolve"_s), resolveFunction, PropertyAttribute::Function | 0);

        return prototype;
    }

    RequireFunctionPrototype(
        JSC::VM& vm,
        JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.functionSpace();
    }

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);
        ASSERT(inherits(vm, info()));

        reifyStaticProperties(vm, info(), RequireFunctionPrototypeValues, *this);
        this->putDirect(vm, JSC::Identifier::fromString(vm, "main"_s), jsUndefined(), 0);
        this->putDirect(vm, JSC::Identifier::fromString(vm, "extensions"_s), constructEmptyObject(globalObject()), 0);
    }
};

void JSCommonJSModule::finishCreation(JSC::VM& vm, JSC::JSValue exportsObject, JSC::JSString* id, JSC::JSString* filename, JSC::JSString* dirname)
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

JSC::Structure* JSCommonJSModule::createStructure(
    JSC::JSGlobalObject* globalObject)
{
    auto& vm = globalObject->vm();

    JSFunction* requireFunction = JSFunction::create(
        vm,
        moduleRequireCodeGenerator(vm),
        globalObject->globalScope(),
        JSFunction::createStructure(vm, globalObject, RequireFunctionPrototype::create(globalObject)));

    JSObject* modulePrototype = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), 1);
    modulePrototype->putDirect(vm, clientData(vm)->builtinNames().requirePublicName(), requireFunction, PropertyAttribute::Builtin | PropertyAttribute::Function | 0);

    modulePrototype->putDirectNativeFunction(
        vm,
        globalObject,
        clientData(vm)->builtinNames().requirePrivateName(),
        2,
        jsFunctionRequireCommonJS, ImplementationVisibility::Public, NoIntrinsic, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);

    JSC::Structure* structure
        = JSC::Structure::create(
            vm,
            globalObject,
            modulePrototype,
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

    return structure;
}

JSCommonJSModule* JSCommonJSModule::create(
    JSC::VM& vm,
    JSC::Structure* structure,
    JSC::JSValue exportsObject,
    JSC::JSString* id,
    JSC::JSString* filename,
    JSC::JSString* dirname)
{
    JSCommonJSModule* cell = new (NotNull, JSC::allocateCell<JSCommonJSModule>(vm)) JSCommonJSModule(vm, structure);
    cell->finishCreation(vm, exportsObject, id, filename, dirname);
    return cell;
}

JSCommonJSModule* JSCommonJSModule::create(
    Zig::GlobalObject* globalObject,
    const WTF::String& key,
    const WTF::String& dirname,
    JSC::JSObject* moduleNamespaceObject)
{
    auto& vm = globalObject->vm();

    auto getDefaultValue = [&]() -> JSValue {
        if (auto defaultValue = moduleNamespaceObject->getIfPropertyExists(globalObject, vm.propertyNames->defaultKeyword)) {
            if (defaultValue && defaultValue.isObject()) {
                JSObject* defaultObject = asObject(defaultValue);
                if (auto isCJS = defaultObject->getIfPropertyExists(globalObject, Identifier::fromUid(vm.symbolRegistry().symbolForKey("CommonJS"_s)))) {
                    if (isCJS.isNumber() && isCJS.toInt32(globalObject) == 0) {
                        return defaultObject;
                    }
                }
            }
        }

        return moduleNamespaceObject;
    };

    return JSCommonJSModule::create(
        vm,
        globalObject->CommonJSModuleObjectStructure(),
        getDefaultValue(),
        JSC::jsString(vm, key), JSC::jsString(vm, key), JSC::jsString(vm, dirname));
}

JSCommonJSModule* JSCommonJSModule::create(
    Zig::GlobalObject* globalObject,
    const WTF::String& key,
    const WTF::String& dirname,
    const SyntheticSourceProvider::SyntheticSourceGenerator& generator)
{
    Vector<JSC::Identifier, 4> propertyNames;
    JSC::MarkedArgumentBuffer arguments;
    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    generator(globalObject, JSC::Identifier::fromString(vm, key), propertyNames, arguments);
    RETURN_IF_EXCEPTION(throwScope, nullptr);

    auto getDefaultValue = [&]() -> JSValue {
        size_t defaultValueIndex = propertyNames.find(vm.propertyNames->defaultKeyword);

        if (defaultValueIndex != notFound) {
            JSValue current = arguments.at(defaultValueIndex);

            if (current && current.isObject()) {
                JSObject* defaultObject = asObject(current);
                if (auto isCJS = defaultObject->getIfPropertyExists(globalObject, Identifier::fromUid(vm.symbolRegistry().symbolForKey("CommonJS"_s)))) {
                    if (isCJS.isNumber() && isCJS.toInt32(globalObject) == 0) {
                        return defaultObject;
                    }
                }
            }
        }

        size_t count = propertyNames.size();
        JSObject* defaultObject = JSC::constructEmptyObject(globalObject, globalObject->objectPrototype(), std::min(count, 64UL));
        for (size_t i = 0; i < count; ++i) {
            defaultObject->putDirect(vm, propertyNames[i], arguments.at(i), 0);
        }

        return defaultObject;
    };

    JSValue defaultValue = getDefaultValue();
    auto* result = JSCommonJSModule::create(
        vm,
        globalObject->CommonJSModuleObjectStructure(),
        defaultValue,
        JSC::jsString(vm, key), JSC::jsString(vm, key), JSC::jsString(vm, dirname));
    globalObject->requireMap()->set(globalObject, result->id(), result);
    return result;
}

void JSCommonJSModule::toSyntheticSource(JSC::JSGlobalObject* globalObject,
    JSC::Identifier moduleKey,
    Vector<JSC::Identifier, 4>& exportNames,
    JSC::MarkedArgumentBuffer& exportValues)
{
    auto result = this->exportsObject();

    auto& vm = globalObject->vm();
    exportNames.append(vm.propertyNames->defaultKeyword);
    exportValues.append(result);

    // This exists to tell ImportMetaObject.ts that this is a CommonJS module.
    exportNames.append(Identifier::fromUid(vm.symbolRegistry().symbolForKey("CommonJS"_s)));
    exportValues.append(jsNumber(0));

    if (result.isObject()) {
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
}

JSValue JSCommonJSModule::exportsObject()
{
    return this->get(globalObject(), JSC::PropertyName(clientData(vm())->builtinNames().exportsPublicName()));
}

JSValue JSCommonJSModule::id()
{
    return m_id.get();
}

bool JSCommonJSModule::put(
    JSC::JSCell* cell,
    JSC::JSGlobalObject* globalObject,
    JSC::PropertyName propertyName,
    JSC::JSValue value,
    JSC::PutPropertySlot& slot)
{

    auto& vm = globalObject->vm();
    auto* clientData = WebCore::clientData(vm);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    RELEASE_AND_RETURN(throwScope, Base::put(cell, globalObject, propertyName, value, slot));
}

template<typename, SubspaceAccess mode> JSC::GCClient::IsoSubspace* JSCommonJSModule::subspaceFor(JSC::VM& vm)
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
const JSC::ClassInfo RequireResolveFunctionPrototype::s_info = { "resolve"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(RequireResolveFunctionPrototype) };
const JSC::ClassInfo RequireFunctionPrototype::s_info = { "require"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(RequireFunctionPrototype) };

JSC_DEFINE_HOST_FUNCTION(jsFunctionRequireCommonJS, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(callframe->thisValue());
    if (!thisObject)
        return throwVMTypeError(globalObject, throwScope);

    WTF::String specifier = callframe->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});

    WTF::String referrer = thisObject->id().toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});

    BunString specifierStr = Bun::toString(specifier);
    BunString referrerStr = Bun::toString(referrer);

    RELEASE_AND_RETURN(throwScope, JSValue::encode(Bun::fetchCommonJSModule(jsCast<Zig::GlobalObject*>(globalObject), &specifierStr, &referrerStr)));
}

void RequireResolveFunctionPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(vm, info()));

    reifyStaticProperties(vm, RequireResolveFunctionPrototype::info(), RequireResolveFunctionPrototypeValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

JSCommonJSModule* runCommonJSModule(
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

    JSC::SourceCode inputSource(
        WTFMove(sourceProvider));

    auto* moduleObject = JSCommonJSModule::create(
        vm,
        globalObject->CommonJSModuleObjectStructure(),
        exportsObject,
        requireMapKey, filename, dirname);

    if (UNLIKELY(throwScope.exception())) {
        RELEASE_AND_RETURN(throwScope, nullptr);
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

    auto* boundRequire = JSC::JSBoundFunction::create(
        vm,
        globalObject,
        moduleObject->get(globalObject, PropertyName(clientData(vm)->builtinNames().requirePublicName())).getObject(),
        moduleObject,
        ArgList(),
        1,
        jsString(vm, WTF::String("require"_s)));

    boundRequire->putDirect(vm, Identifier::fromString(vm, "id"_s), requireMapKey, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::ReadOnly);

    thisObject->putDirectOffset(
        vm,
        2,
        boundRequire);

    thisObject->putDirectOffset(
        vm,
        3,
        dirname);

    thisObject->putDirectOffset(
        vm,
        4,
        filename);

    {
        globalObject->m_BunCommonJSModuleValue.set(vm, globalObject, thisObject);

        globalObject->requireMap()->set(globalObject, requireMapKey, moduleObject);

        EvalExecutable* eval = IndirectEvalExecutable::tryCreate(globalObject, inputSource, DerivedContextType::None, false, EvalContextType::None);
        JSC::Strong<EvalExecutable> strongEval(vm, eval);
        if (throwScope.exception()) {
            return nullptr;
        }

        JSC::JSValue result = vm.interpreter.executeEval(eval, thisObject, globalObject->globalScope());

        if (throwScope.exception()) {
            return nullptr;
        }
    }

    return moduleObject;
}

JSCommonJSModule* JSCommonJSModule::create(
    Zig::GlobalObject* globalObject,
    const WTF::String& key,
    ResolvedSource source)
{
    auto sourceProvider = Zig::SourceProvider::create(jsCast<Zig::GlobalObject*>(globalObject), source, JSC::SourceProviderSourceType::Program);
    return runCommonJSModule(globalObject, WTFMove(sourceProvider), key, source);
}

JSValue evaluateCommonJSModule(
    Zig::GlobalObject* globalObject,
    Ref<Zig::SourceProvider> sourceProvider,
    const WTF::String& sourceURL,
    ResolvedSource source)
{
    auto& vm = globalObject->vm();

    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (UNLIKELY(throwScope.exception())) {
        RELEASE_AND_RETURN(throwScope, JSValue());
    }

    auto* moduleObject = runCommonJSModule(globalObject, WTFMove(sourceProvider), sourceURL, source);
    if (UNLIKELY(throwScope.exception())) {
        RELEASE_AND_RETURN(throwScope, JSValue());
    }

    return moduleObject->exportsObject();
}

JSC::SourceCode createCommonJSModule(
    Zig::GlobalObject* globalObject,
    ResolvedSource source)
{
    auto sourceURL = Zig::toStringCopy(source.source_url);
    auto sourceProvider = Zig::SourceProvider::create(jsCast<Zig::GlobalObject*>(globalObject), source, JSC::SourceProviderSourceType::Program);
    auto* moduleObject = runCommonJSModule(jsCast<Zig::GlobalObject*>(globalObject), WTFMove(sourceProvider), sourceURL, source);
    if (!moduleObject)
        return JSC::SourceCode();
    gcProtect(moduleObject);
    return JSC::SourceCode(
        JSC::SyntheticSourceProvider::create(
            [moduleObject](JSC::JSGlobalObject* globalObject,
                JSC::Identifier moduleKey,
                Vector<JSC::Identifier, 4>& exportNames,
                JSC::MarkedArgumentBuffer& exportValues) -> void {
                moduleObject->toSyntheticSource(globalObject, moduleKey, exportNames, exportValues);
                gcUnprotect(moduleObject);
            },
            SourceOrigin(WTF::URL::fileURLWithFileSystemPath(sourceURL)),
            sourceURL));
}

}