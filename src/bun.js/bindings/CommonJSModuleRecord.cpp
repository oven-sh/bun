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
#include <JavaScriptCore/JSSourceCode.h>

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

JSC_DEFINE_HOST_FUNCTION(Bun::jsCommonJSLoadModule, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(callframe->argument(0));
    if (!thisObject || !thisObject->sourceCode)
        return JSValue::encode(callframe->argument(0));

    JSFunction* fn = thisObject->compile(vm, globalObject);

    if (fn) {
        auto* boundRequire = JSC::JSBoundFunction::create(
            vm,
            globalObject,
            thisObject->get(globalObject, WebCore::clientData(vm)->builtinNames().requirePublicName()).getObject(),
            thisObject,
            ArgList(),
            1,
            nullptr);

        boundRequire->putDirect(vm, Identifier::fromString(vm, "id"_s), thisObject->id(), JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::ReadOnly);
    }
    RELEASE_AND_RETURN(throwScope, JSValue::encode(thisObject->compile(vm, globalObject)));
}

JSC_DEFINE_CUSTOM_GETTER(getterFilename, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(thisObject->m_filename.get());
}
JSC_DEFINE_CUSTOM_GETTER(getterId, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(thisObject->m_id.get());
}

JSC_DEFINE_CUSTOM_GETTER(getterPath, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(thisObject->m_id.get());
}

JSC_DEFINE_CUSTOM_SETTER(setterPath,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName propertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (!thisObject)
        return false;

    thisObject->m_id.set(globalObject->vm(), thisObject, JSValue::decode(value).toString(globalObject));
    return true;
}

JSC_DEFINE_CUSTOM_SETTER(setterFilename,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName propertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (!thisObject)
        return false;

    thisObject->m_filename.set(globalObject->vm(), thisObject, JSValue::decode(value).toString(globalObject));
    return true;
}

JSC_DEFINE_CUSTOM_SETTER(setterId,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName propertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (!thisObject)
        return false;

    thisObject->m_id.set(globalObject->vm(), thisObject, JSValue::decode(value).toString(globalObject));
    return true;
}

static JSValue createLoaded(VM& vm, JSObject* object)
{
    JSCommonJSModule* cjs = jsCast<JSCommonJSModule*>(object);
    return jsBoolean(true);
}
static JSValue createParent(VM& vm, JSObject* object)
{
    return jsUndefined();
}
static JSValue createChildren(VM& vm, JSObject* object)
{
    return constructEmptyArray(object->globalObject(), nullptr, 0);
}

static const struct HashTableValue JSCommonJSModulePrototypeTableValues[] = {
    { "children"_s, static_cast<unsigned>(PropertyAttribute::PropertyCallback | PropertyAttribute::DontEnum | 0), NoIntrinsic, { HashTableValue::LazyPropertyType, createChildren } },
    { "filename"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, getterFilename, setterFilename } },
    { "id"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, getterId, setterId } },
    { "loaded"_s, static_cast<unsigned>(PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, createLoaded } },
    { "parent"_s, static_cast<unsigned>(PropertyAttribute::PropertyCallback | PropertyAttribute::DontEnum | 0), NoIntrinsic, { HashTableValue::LazyPropertyType, createParent } },
    { "path"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, getterPath, setterPath } },
};

class JSCommonJSModulePrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSCommonJSModulePrototype* create(
        JSC::VM& vm,
        JSC::JSGlobalObject* globalObject,
        JSC::Structure* structure)
    {
        JSCommonJSModulePrototype* prototype = new (NotNull, JSC::allocateCell<JSCommonJSModulePrototype>(vm)) JSCommonJSModulePrototype(vm, structure);
        prototype->finishCreation(vm, globalObject);
        return prototype;
    }

    DECLARE_INFO;

    JSCommonJSModulePrototype(
        JSC::VM& vm,
        JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        Base::finishCreation(vm);
        ASSERT(inherits(vm, info()));
        reifyStaticProperties(vm, JSCommonJSModule::info(), JSCommonJSModulePrototypeTableValues, *this);

        JSFunction* requireFunction = JSFunction::create(
            vm,
            moduleRequireCodeGenerator(vm),
            globalObject->globalScope(),
            JSFunction::createStructure(vm, globalObject, RequireFunctionPrototype::create(globalObject)));

        this->putDirect(vm, clientData(vm)->builtinNames().requirePublicName(), requireFunction, PropertyAttribute::Builtin | PropertyAttribute::Function | 0);

        this->putDirectNativeFunction(
            vm,
            globalObject,
            clientData(vm)->builtinNames().requirePrivateName(),
            2,
            jsFunctionRequireCommonJS, ImplementationVisibility::Public, NoIntrinsic, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete | 0);
    }
};

const JSC::ClassInfo JSCommonJSModulePrototype::s_info = { "Module"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCommonJSModulePrototype) };

void JSCommonJSModule::finishCreation(JSC::VM& vm, JSC::JSString* id, JSC::JSString* filename, JSC::JSString* dirname, JSC::JSSourceCode* sourceCode)
{
    Base::finishCreation(vm);
    ASSERT(inherits(vm, info()));
    m_id.set(vm, this, id);
    m_filename.set(vm, this, filename);
    m_dirname.set(vm, this, dirname);
    this->sourceCode.set(vm, this, sourceCode);
}

JSC::Structure* JSCommonJSModule::createStructure(
    JSC::JSGlobalObject* globalObject)
{
    auto& vm = globalObject->vm();

    auto* prototype = JSCommonJSModulePrototype::create(vm, globalObject, JSCommonJSModulePrototype::createStructure(vm, globalObject, globalObject->objectPrototype()));

    return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
}

JSCommonJSModule* JSCommonJSModule::create(
    JSC::VM& vm,
    JSC::Structure* structure,
    JSC::JSString* id,
    JSC::JSString* filename,
    JSC::JSString* dirname,
    JSC::JSSourceCode* sourceCode)
{
    JSCommonJSModule* cell = new (NotNull, JSC::allocateCell<JSCommonJSModule>(vm)) JSCommonJSModule(vm, structure);
    cell->finishCreation(vm, id, filename, dirname, sourceCode);
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

    auto* out = JSCommonJSModule::create(
        vm,
        globalObject->CommonJSModuleObjectStructure(),
        JSC::jsString(vm, key), JSC::jsString(vm, key), JSC::jsString(vm, dirname), nullptr);
    out->putDirect(vm, Identifier::fromString(vm, "exports"_s), getDefaultValue(), 0);
    return out;
}

void JSCommonJSModule::destroy(JSC::JSCell* cell)
{
    static_cast<JSCommonJSModule*>(cell)->JSCommonJSModule::~JSCommonJSModule();
}

JSCommonJSModule::~JSCommonJSModule()
{
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
        JSC::jsString(vm, key), JSC::jsString(vm, key), JSC::jsString(vm, dirname), nullptr);
    result->putDirect(vm, JSC::Identifier::fromString(vm, "exports"_s), defaultValue, 0);
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

extern "C" EncodedJSValue vmEntryToJavaScript(void*, VM*, ProtoCallFrame*);

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
    visitor.append(thisObject->m_id);
    visitor.append(thisObject->sourceCode);
    visitor.append(thisObject->m_filename);
    visitor.append(thisObject->m_dirname);
    visitor.append(thisObject->m_compiledFunction);
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

JSFunction* JSCommonJSModule::compile(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
{
    if (this->m_compiledFunction)
        return this->m_compiledFunction.get();

    JSC::JSObject* thisObject = JSC::constructEmptyObject(
        vm,
        jsCast<Zig::GlobalObject*>(globalObject)->commonJSFunctionArgumentsStructure());

    thisObject->putDirectOffset(vm, 0, jsUndefined());
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    JSValue result = JSC::evaluate(globalObject, this->sourceCode.get()->sourceCode(), thisObject);

    if (UNLIKELY(throwScope.exception()))
        return nullptr;

    JSFunction* fn = jsDynamicCast<JSFunction*>(result);

    if (UNLIKELY(!fn))
        return nullptr;

    this->m_compiledFunction.set(vm, this, fn);
    this->sourceCode.clear();

    return fn;
}

void RequireResolveFunctionPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(vm, info()));

    reifyStaticProperties(vm, RequireResolveFunctionPrototype::info(), RequireResolveFunctionPrototypeValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

JSCommonJSModule* createCommonJSModuleWithoutRunning(
    Zig::GlobalObject* globalObject,
    Ref<Zig::SourceProvider> sourceProvider,
    const WTF::String& sourceURL,
    ResolvedSource source)
{
    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* requireMapKey = jsString(vm, sourceURL);

    auto index = sourceURL.reverseFind('/', sourceURL.length());
    JSString* dirname = jsEmptyString(vm);
    JSString* filename = requireMapKey;
    if (index != WTF::notFound) {
        dirname = JSC::jsSubstring(globalObject, requireMapKey, 0, index);
    }

    JSC::SourceCode rawInputSource(
        WTFMove(sourceProvider));

    auto* moduleObject = JSCommonJSModule::create(
        vm,
        globalObject->CommonJSModuleObjectStructure(),
        requireMapKey, filename, dirname, JSC::JSSourceCode::create(vm, WTFMove(rawInputSource)));

    if (UNLIKELY(throwScope.exception())) {
        RELEASE_AND_RETURN(throwScope, nullptr);
    }

    moduleObject->putDirect(vm, Identifier::fromString(vm, "exports"_s), JSC::constructEmptyObject(globalObject, globalObject->objectPrototype()), 0);

    return moduleObject;
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

    auto* moduleObject = createCommonJSModuleWithoutRunning(globalObject, WTFMove(sourceProvider), sourceURL, source);

    {
        auto* function = moduleObject->compile(vm, globalObject);
        if (throwScope.exception() || !function) {
            RELEASE_AND_RETURN(throwScope, nullptr);
        }

        auto requireFunction = moduleObject->getPrototype(vm, globalObject).getObject()->getDirect(vm, WebCore::clientData(vm)->builtinNames().requirePublicName());

        auto* boundRequire = JSC::JSBoundFunction::create(
            vm,
            globalObject,
            requireFunction.getObject(),
            moduleObject,
            ArgList(),
            1,
            nullptr);

        boundRequire->putDirect(vm, Identifier::fromString(vm, "id"_s), requireMapKey, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::ReadOnly);

        MarkedArgumentBuffer args;
        args.append(moduleObject);
        args.append(moduleObject->get(globalObject, Identifier::fromString(vm, "exports"_s)));
        args.append(boundRequire);
        args.append(moduleObject->m_dirname.get());
        args.append(moduleObject->m_filename.get());

        globalObject->requireMap()->set(globalObject, requireMapKey, moduleObject);

        JSC::call(globalObject, function, JSC::getCallData(function), moduleObject, args);

        if (throwScope.exception()) {
            RELEASE_AND_RETURN(throwScope, nullptr);
        }

        globalObject->requireMap()->set(globalObject, requireMapKey, moduleObject);
    }

    return moduleObject;
}

JSCommonJSModule* JSCommonJSModule::create(
    Zig::GlobalObject* globalObject,
    const WTF::String& key,
    ResolvedSource source)
{
    auto sourceProvider = Zig::SourceProvider::create(jsCast<Zig::GlobalObject*>(globalObject), source, JSC::SourceProviderSourceType::Program);
    return runCommonJSModule(globalObject, WTFMove(sourceProvider), key.isolatedCopy(), source);
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

std::optional<JSC::SourceCode> createCommonJSModule(
    Zig::GlobalObject* globalObject,
    ResolvedSource source)
{
    auto sourceURL = Zig::toStringCopy(source.source_url);
    auto sourceProvider = Zig::SourceProvider::create(jsCast<Zig::GlobalObject*>(globalObject), source, JSC::SourceProviderSourceType::Program);

    return JSC::SourceCode(
        JSC::SyntheticSourceProvider::create(
            [sourceURL, source, sourceProvider = WTFMove(sourceProvider)](JSC::JSGlobalObject* globalObject,
                JSC::Identifier moduleKey,
                Vector<JSC::Identifier, 4>& exportNames,
                JSC::MarkedArgumentBuffer& exportValues) -> void {
                auto* moduleObject = runCommonJSModule(jsCast<Zig::GlobalObject*>(globalObject), WTFMove(sourceProvider), sourceURL, source);
                if (UNLIKELY(!moduleObject)) {
                    return;
                }
                moduleObject->toSyntheticSource(globalObject, moduleKey, exportNames, exportValues);
            },
            SourceOrigin(WTF::URL::fileURLWithFileSystemPath(sourceURL)),
            sourceURL));
}
}