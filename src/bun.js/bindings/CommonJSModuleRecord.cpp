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
#include <JavaScriptCore/LazyPropertyInlines.h>

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

static bool evaluateCommonJSModuleOnce(JSC::VM& vm, Zig::GlobalObject* globalObject, JSCommonJSModule* moduleObject, JSString* dirname, JSString* filename, WTF::NakedPtr<Exception>& exception)
{
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
        dirname);

    thisObject->putDirectOffset(
        vm,
        2,
        filename);

    moduleObject->hasEvaluated = true;
    globalObject->m_BunCommonJSModuleValue.set(vm, globalObject, thisObject);

    JSValue empty = JSC::evaluate(globalObject, moduleObject->sourceCode.get()->sourceCode(), thisObject, exception);
    moduleObject->sourceCode.clear();

    return exception.get() == nullptr;
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionLoadModule, (JSGlobalObject * lexicalGlobalObject, CallFrame* callframe))
{
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSCommonJSModule* moduleObject = jsDynamicCast<JSCommonJSModule*>(callframe->argument(0));
    if (!moduleObject) {
        RELEASE_AND_RETURN(throwScope, JSValue::encode(jsBoolean(true)));
    }

    if (moduleObject->hasEvaluated || !moduleObject->sourceCode) {
        RELEASE_AND_RETURN(throwScope, JSValue::encode(jsBoolean(true)));
    }

    WTF::NakedPtr<Exception> exception;

    evaluateCommonJSModuleOnce(
        globalObject->vm(),
        jsCast<Zig::GlobalObject*>(globalObject),
        moduleObject,
        moduleObject->m_dirname.get(),
        moduleObject->m_filename.get(),
        exception);

    if (exception.get()) {
        // On error, remove the module from the require map/
        // so that it can be re-evaluated on the next require.
        globalObject->requireMap()->remove(globalObject, moduleObject->id());

        throwException(globalObject, throwScope, exception.get());
        exception.clear();
        return JSValue::encode({});
    }

    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsBoolean(true)));
}

JSC_DEFINE_HOST_FUNCTION(requireResolvePathsFunction, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    return JSValue::encode(JSC::constructEmptyArray(globalObject, nullptr, 0));
}

JSC_DEFINE_CUSTOM_GETTER(jsRequireCacheGetter, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    Zig::GlobalObject* thisObject = jsCast<Zig::GlobalObject*>(globalObject);
    return JSValue::encode(thisObject->lazyRequireCacheObject());
}

JSC_DEFINE_CUSTOM_SETTER(jsRequireCacheSetter,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName propertyName))
{
    JSObject* thisObject = jsDynamicCast<JSObject*>(JSValue::decode(thisValue));
    if (!thisObject)
        return false;

    thisObject->putDirect(globalObject->vm(), propertyName, JSValue::decode(value), 0);
    return true;
}

static const HashTableValue RequireResolveFunctionPrototypeValues[] = {
    { "paths"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, requireResolvePathsFunction, 1 } },
};

static const HashTableValue RequireFunctionPrototypeValues[] = {
    { "cache"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsRequireCacheGetter, jsRequireCacheSetter } },
};

RequireResolveFunctionPrototype* RequireResolveFunctionPrototype::create(JSC::JSGlobalObject* globalObject)
{
    auto& vm = globalObject->vm();

    auto* structure = RequireResolveFunctionPrototype::createStructure(vm, globalObject, globalObject->functionPrototype());
    RequireResolveFunctionPrototype* prototype = new (NotNull, JSC::allocateCell<RequireResolveFunctionPrototype>(vm)) RequireResolveFunctionPrototype(vm, structure);
    prototype->finishCreation(vm);
    return prototype;
}

RequireFunctionPrototype* RequireFunctionPrototype::create(
    JSC::JSGlobalObject* globalObject)
{
    auto& vm = globalObject->vm();

    auto* structure = RequireFunctionPrototype::createStructure(vm, globalObject, globalObject->functionPrototype());
    RequireFunctionPrototype* prototype = new (NotNull, JSC::allocateCell<RequireFunctionPrototype>(vm)) RequireFunctionPrototype(vm, structure);
    prototype->finishCreation(vm);

    prototype->putDirect(vm, JSC::Identifier::fromString(vm, "resolve"_s), static_cast<Zig::GlobalObject*>(globalObject)->requireResolveFunctionUnbound(), PropertyAttribute::Function | 0);

    return prototype;
}

void RequireFunctionPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(vm, info()));

    reifyStaticProperties(vm, info(), RequireFunctionPrototypeValues, *this);
    JSC::JSFunction* requireDotMainFunction = JSFunction::create(
        vm,
        moduleMainCodeGenerator(vm),
        globalObject()->globalScope());

    this->putDirect(
        vm,
        JSC::Identifier::fromString(vm, "main"_s),
        JSC::GetterSetter::create(vm, globalObject(), requireDotMainFunction, JSValue()),
        PropertyAttribute::Builtin | PropertyAttribute::Accessor | PropertyAttribute::ReadOnly | 0);
    this->putDirect(vm, JSC::Identifier::fromString(vm, "extensions"_s), constructEmptyObject(globalObject()), 0);
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

extern "C" EncodedJSValue Resolver__propForRequireMainPaths(JSGlobalObject*);

JSC_DEFINE_CUSTOM_GETTER(getterPaths, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        return JSValue::encode(jsUndefined());
    }

    if (!thisObject->m_paths) {
        JSValue paths = JSValue::decode(Resolver__propForRequireMainPaths(globalObject));
        thisObject->m_paths.set(globalObject->vm(), thisObject, paths);
    }

    return JSValue::encode(thisObject->m_paths.get());
}

JSC_DEFINE_CUSTOM_SETTER(setterPaths,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName propertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (!thisObject)
        return false;

    thisObject->m_paths.set(globalObject->vm(), thisObject, JSValue::decode(value));
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
    return jsBoolean(cjs->hasEvaluated);
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
    { "loaded"_s, static_cast<unsigned>(PropertyAttribute::PropertyCallback | PropertyAttribute::DontEnum | 0), NoIntrinsic, { HashTableValue::LazyPropertyType, createLoaded } },
    { "parent"_s, static_cast<unsigned>(PropertyAttribute::PropertyCallback | PropertyAttribute::DontEnum | 0), NoIntrinsic, { HashTableValue::LazyPropertyType, createParent } },
    { "path"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, getterPath, setterPath } },
    { "paths"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, getterPaths, setterPaths } },
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

        this->putDirect(vm, clientData(vm)->builtinNames().requirePublicName(), (static_cast<Zig::GlobalObject*>(globalObject))->requireFunctionUnbound(), PropertyAttribute::Builtin | PropertyAttribute::Function | 0);

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

    // Do not set the number of inline properties on this structure
    // there may be an off-by-one error in the Structure which causes `require.id` to become the require
    return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info(), NonArray);
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

JSC_DEFINE_HOST_FUNCTION(jsFunctionCreateCommonJSModule, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    auto& vm = globalObject->vm();

    auto id = callframe->argument(0).toWTFString(globalObject);

    JSValue object = callframe->argument(1);

    return JSValue::encode(
        JSCommonJSModule::create(
            jsCast<Zig::GlobalObject*>(globalObject),
            id,
            object, callframe->argument(2).isBoolean() && callframe->argument(2).asBoolean()));
}

JSCommonJSModule* JSCommonJSModule::create(
    Zig::GlobalObject* globalObject,
    const WTF::String& key,
    JSValue exportsObject,
    bool hasEvaluated)
{
    auto& vm = globalObject->vm();
    JSString* requireMapKey = JSC::jsStringWithCache(vm, key);
    auto index = key.reverseFind('/', key.length());
    JSString* dirname = jsEmptyString(vm);
    if (index != WTF::notFound) {
        dirname = JSC::jsSubstring(globalObject, requireMapKey, 0, index);
    }

    auto* out = JSCommonJSModule::create(
        vm,
        globalObject->CommonJSModuleObjectStructure(),
        requireMapKey, requireMapKey, dirname, nullptr);

    out->putDirect(vm, WebCore::clientData(vm)->builtinNames().exportsPublicName(), exportsObject, exportsObject.isCell() && exportsObject.isCallable() ? JSC::PropertyAttribute::Function | 0 : 0);
    out->hasEvaluated = hasEvaluated;
    return out;
}

void JSCommonJSModule::destroy(JSC::JSCell* cell)
{
    static_cast<JSCommonJSModule*>(cell)->JSCommonJSModule::~JSCommonJSModule();
}

JSCommonJSModule::~JSCommonJSModule()
{
}

bool JSCommonJSModule::evaluate(
    Zig::GlobalObject* globalObject,
    const WTF::String& key,
    const SyntheticSourceProvider::SyntheticSourceGenerator& generator)
{
    Vector<JSC::Identifier, 4> propertyNames;
    JSC::MarkedArgumentBuffer arguments;
    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    // TODO: remove second arg, we do not use it ???
    // was it object loader?
    generator(globalObject, JSC::Identifier::fromString(vm, key), propertyNames, arguments);
    RETURN_IF_EXCEPTION(throwScope, false);
    JSValue defaultValue = arguments.at(0);
    this->putDirect(vm, WebCore::clientData(vm)->builtinNames().exportsPublicName(), defaultValue, 0);
    this->hasEvaluated = true;
    RELEASE_AND_RETURN(throwScope, true);
}

void JSCommonJSModule::toSyntheticSource(JSC::JSGlobalObject* globalObject,
    JSC::Identifier moduleKey,
    Vector<JSC::Identifier, 4>& exportNames,
    JSC::MarkedArgumentBuffer& exportValues)
{
    auto result = this->exportsObject();

    auto& vm = globalObject->vm();

    // Bun's intepretation of the "__esModule" annotation:
    //
    //   - If a "default" export does not exist OR the __esModule annotation is not present, then we
    //   set the default export to the exports object
    //
    //   - If a "default" export also exists, then we set the default export
    //   to the value of it (matching Babel behavior)
    //
    // https://stackoverflow.com/questions/50943704/whats-the-purpose-of-object-definepropertyexports-esmodule-value-0
    // https://github.com/nodejs/node/issues/40891
    // https://github.com/evanw/bundler-esm-cjs-tests
    // https://github.com/evanw/esbuild/issues/1591
    // https://github.com/oven-sh/bun/issues/3383
    //
    // Note that this interpretation is slightly different
    //
    //    -  We do not ignore when "type": "module" or when the file
    //       extension is ".mjs". Build tools determine that based on the
    //       caller's behavior, but in a JS runtime, there is only one ModuleNamespaceObject.
    //
    //       It would be possible to match the behavior at runtime, but
    //       it would need further engine changes which do not match the ES Module spec
    //
    //   -   We ignore the value of the annotation. We only look for the
    //       existence of the value being set. This is for performance reasons, but also
    //       this annotation is meant for tooling and the only usages of setting
    //       it to something that does NOT evaluate to "true" I could find were in
    //       unit tests of build tools. Happy to revisit this if users file an issue.
    bool needsToAssignDefault = true;

    if (result.isObject()) {
        auto* exports = asObject(result);

        auto* structure = exports->structure();
        uint32_t size = structure->inlineSize() + structure->outOfLineSize();
        exportNames.reserveCapacity(size + 2);
        exportValues.ensureCapacity(size + 2);

        auto catchScope = DECLARE_CATCH_SCOPE(vm);

        Identifier esModuleMarker = builtinNames(vm).__esModulePublicName();
        bool hasESModuleMarker = !this->ignoreESModuleAnnotation && exports->hasProperty(globalObject, esModuleMarker);
        if (catchScope.exception()) {
            catchScope.clearException();
        }

        if (hasESModuleMarker) {
            if (canPerformFastEnumeration(structure)) {
                exports->structure()->forEachProperty(vm, [&](const PropertyTableEntry& entry) -> bool {
                    auto key = entry.key();
                    if (key->isSymbol() || entry.attributes() & PropertyAttribute::DontEnum || key == esModuleMarker)
                        return true;

                    needsToAssignDefault = needsToAssignDefault && key != vm.propertyNames->defaultKeyword;

                    JSValue value = exports->getDirect(entry.offset());
                    exportNames.append(Identifier::fromUid(vm, key));
                    exportValues.append(value);
                    return true;
                });
            } else {
                JSC::PropertyNameArray properties(vm, JSC::PropertyNameMode::Strings, JSC::PrivateSymbolMode::Exclude);
                exports->methodTable()->getOwnPropertyNames(exports, globalObject, properties, DontEnumPropertiesMode::Exclude);
                if (catchScope.exception()) {
                    catchScope.clearExceptionExceptTermination();
                    return;
                }

                for (auto property : properties) {
                    if (UNLIKELY(property.isEmpty() || property.isNull() || property == esModuleMarker || property.isPrivateName() || property.isSymbol()))
                        continue;

                    // ignore constructor
                    if (property == vm.propertyNames->constructor)
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

                    needsToAssignDefault = needsToAssignDefault && property != vm.propertyNames->defaultKeyword;
                }
            }

        } else if (canPerformFastEnumeration(structure)) {
            exports->structure()->forEachProperty(vm, [&](const PropertyTableEntry& entry) -> bool {
                auto key = entry.key();
                if (key->isSymbol() || entry.attributes() & PropertyAttribute::DontEnum || key == vm.propertyNames->defaultKeyword)
                    return true;

                JSValue value = exports->getDirect(entry.offset());

                exportNames.append(Identifier::fromUid(vm, key));
                exportValues.append(value);
                return true;
            });
        } else {
            JSC::PropertyNameArray properties(vm, JSC::PropertyNameMode::Strings, JSC::PrivateSymbolMode::Exclude);
            exports->methodTable()->getOwnPropertyNames(exports, globalObject, properties, DontEnumPropertiesMode::Exclude);
            if (catchScope.exception()) {
                catchScope.clearExceptionExceptTermination();
                return;
            }

            for (auto property : properties) {
                if (UNLIKELY(property.isEmpty() || property.isNull() || property == vm.propertyNames->defaultKeyword || property.isPrivateName() || property.isSymbol()))
                    continue;

                // ignore constructor
                if (property == vm.propertyNames->constructor)
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

    if (needsToAssignDefault) {
        exportNames.append(vm.propertyNames->defaultKeyword);
        exportValues.append(result);
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
    visitor.append(thisObject->m_id);
    visitor.append(thisObject->sourceCode);
    visitor.append(thisObject->m_filename);
    visitor.append(thisObject->m_dirname);
    visitor.append(thisObject->m_paths);
}

DEFINE_VISIT_CHILDREN(JSCommonJSModule);
const JSC::ClassInfo JSCommonJSModule::s_info = { "Module"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCommonJSModule) };
const JSC::ClassInfo RequireResolveFunctionPrototype::s_info = { "resolve"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(RequireResolveFunctionPrototype) };
const JSC::ClassInfo RequireFunctionPrototype::s_info = { "require"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(RequireFunctionPrototype) };

JSC_DEFINE_HOST_FUNCTION(jsFunctionRequireCommonJS, (JSGlobalObject * lexicalGlobalObject, CallFrame* callframe))
{
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(callframe->thisValue());
    if (!thisObject)
        return throwVMTypeError(globalObject, throwScope);

    JSValue specifierValue = callframe->argument(0);
    WTF::String specifier = specifierValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});

    // Special-case for "process" to just return the process object directly.
    if (UNLIKELY(specifier == "process"_s || specifier == "node:process"_s)) {
        jsDynamicCast<JSCommonJSModule*>(callframe->argument(1))->putDirect(vm, builtinNames(vm).exportsPublicName(), globalObject->processObject(), 0);
        return JSValue::encode(globalObject->processObject());
    }

    WTF::String referrer = thisObject->id().toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});

    BunString specifierStr = Bun::toString(specifier);
    BunString referrerStr = Bun::toString(referrer);

    JSValue fetchResult = Bun::fetchCommonJSModule(
        globalObject,
        jsDynamicCast<JSCommonJSModule*>(callframe->argument(1)),
        specifierValue,
        &specifierStr,
        &referrerStr);

    RELEASE_AND_RETURN(throwScope, JSValue::encode(fetchResult));
}

// Used by $requireBuiltin(...) (Module.ts)
JSC_DEFINE_HOST_FUNCTION(jsFunctionCreateAndLoadBuiltinModule, (JSGlobalObject * lexicalGlobalObject, CallFrame* callframe))
{
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    JSValue specifierValue = callframe->argument(0);
    WTF::String specifier = specifierValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});

    BunString specifierStr = Bun::toString(specifier);
    BunString referrerStr = Bun::toString(""_s);

    JSValue fetchResult = Bun::fetchCommonJSModule(
        globalObject,
        JSCommonJSModule::create(
            jsCast<Zig::GlobalObject*>(globalObject),
            specifier,
            constructEmptyObject(globalObject), false),
        specifierValue,
        &specifierStr,
        &referrerStr);

    RELEASE_AND_RETURN(throwScope, JSValue::encode(fetchResult));
}

void RequireResolveFunctionPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(vm, info()));

    reifyStaticProperties(vm, RequireResolveFunctionPrototype::info(), RequireResolveFunctionPrototypeValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

bool JSCommonJSModule::evaluate(
    Zig::GlobalObject* globalObject,
    const WTF::String& key,
    ResolvedSource source,
    bool isBuiltIn)
{
    auto& vm = globalObject->vm();
    auto sourceProvider = Zig::SourceProvider::create(jsCast<Zig::GlobalObject*>(globalObject), source, JSC::SourceProviderSourceType::Program, isBuiltIn);
    this->ignoreESModuleAnnotation = source.tag == ResolvedSourceTagPackageJSONTypeModule;
    JSC::SourceCode rawInputSource(
        WTFMove(sourceProvider));

    if (this->hasEvaluated)
        return true;

    this->sourceCode.set(vm, this, JSC::JSSourceCode::create(vm, WTFMove(rawInputSource)));

    WTF::NakedPtr<JSC::Exception> exception;

    evaluateCommonJSModuleOnce(vm, globalObject, this, this->m_dirname.get(), this->m_filename.get(), exception);

    if (exception.get()) {
        // On error, remove the module from the require map/
        // so that it can be re-evaluated on the next require.
        globalObject->requireMap()->remove(globalObject, this->id());

        auto throwScope = DECLARE_THROW_SCOPE(vm);
        throwException(globalObject, throwScope, exception.get());
        exception.clear();

        return false;
    }

    return true;
}

std::optional<JSC::SourceCode> createCommonJSModule(
    Zig::GlobalObject* globalObject,
    ResolvedSource source,
    bool isBuiltIn)
{
    JSCommonJSModule* moduleObject;
    WTF::String sourceURL = toStringCopy(source.source_url);

    JSValue specifierValue = Bun::toJS(globalObject, source.specifier);
    JSValue entry = globalObject->requireMap()->get(globalObject, specifierValue);

    auto sourceProvider = Zig::SourceProvider::create(jsCast<Zig::GlobalObject*>(globalObject), source, JSC::SourceProviderSourceType::Program, isBuiltIn);
    bool ignoreESModuleAnnotation = source.tag == ResolvedSourceTagPackageJSONTypeModule;
    SourceOrigin sourceOrigin = sourceProvider->sourceOrigin();

    if (entry) {
        moduleObject = jsDynamicCast<JSCommonJSModule*>(entry);
    }

    if (!moduleObject) {
        auto& vm = globalObject->vm();
        auto* requireMapKey = jsStringWithCache(vm, sourceURL);
        auto index = sourceURL.reverseFind('/', sourceURL.length());
        JSString* dirname = jsEmptyString(vm);
        JSString* filename = requireMapKey;
        if (index != WTF::notFound) {
            dirname = JSC::jsSubstring(globalObject, requireMapKey, 0, index);
        }

        JSC::SourceCode rawInputSource(
            WTFMove(sourceProvider));

        moduleObject = JSCommonJSModule::create(
            vm,
            globalObject->CommonJSModuleObjectStructure(),
            requireMapKey, filename, dirname, JSC::JSSourceCode::create(vm, WTFMove(rawInputSource)));

        moduleObject->putDirect(vm,
            WebCore::clientData(vm)->builtinNames().exportsPublicName(),
            JSC::constructEmptyObject(globalObject, globalObject->objectPrototype()), 0);

        globalObject->requireMap()->set(globalObject, requireMapKey, moduleObject);
    }

    moduleObject->ignoreESModuleAnnotation = ignoreESModuleAnnotation;

    return JSC::SourceCode(
        JSC::SyntheticSourceProvider::create(
            [](JSC::JSGlobalObject* lexicalGlobalObject,
                JSC::Identifier moduleKey,
                Vector<JSC::Identifier, 4>& exportNames,
                JSC::MarkedArgumentBuffer& exportValues) -> void {
                auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
                auto& vm = globalObject->vm();

                JSValue keyValue = identifierToJSValue(vm, moduleKey);
                JSValue entry = globalObject->requireMap()->get(globalObject, keyValue);

                if (entry) {
                    if (auto* moduleObject = jsDynamicCast<JSCommonJSModule*>(entry)) {
                        if (!moduleObject->hasEvaluated) {
                            WTF::NakedPtr<JSC::Exception> exception;
                            if (!evaluateCommonJSModuleOnce(
                                    vm,
                                    globalObject,
                                    moduleObject,
                                    moduleObject->m_dirname.get(),
                                    moduleObject->m_filename.get(), exception)) {

                                // On error, remove the module from the require map
                                // so that it can be re-evaluated on the next require.
                                globalObject->requireMap()->remove(globalObject, moduleObject->id());

                                auto scope = DECLARE_THROW_SCOPE(vm);
                                throwException(globalObject, scope, exception.get());
                                exception.clear();
                                return;
                            }
                        }

                        moduleObject->toSyntheticSource(globalObject, moduleKey, exportNames, exportValues);
                    }
                }
            },
            sourceOrigin,
            sourceURL));
}

JSObject* JSCommonJSModule::createBoundRequireFunction(VM& vm, JSGlobalObject* lexicalGlobalObject, const WTF::String& pathString)
{
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);

    JSString* filename = JSC::jsStringWithCache(vm, pathString);
    auto index = pathString.reverseFind('/', pathString.length());
    JSString* dirname = jsEmptyString(vm);
    if (index != WTF::notFound) {
        dirname = JSC::jsSubstring(globalObject, filename, 0, index);
    }

    auto moduleObject = Bun::JSCommonJSModule::create(
        vm,
        globalObject->CommonJSModuleObjectStructure(),
        filename, filename, dirname, nullptr);

    auto& builtinNames = WebCore::builtinNames(vm);

    JSFunction* requireFunction = JSC::JSBoundFunction::create(vm,
        globalObject,
        globalObject->requireFunctionUnbound(),
        moduleObject,
        ArgList(), 1, jsString(vm, String("require"_s)));

    JSFunction* resolveFunction = JSC::JSBoundFunction::create(vm,
        globalObject,
        globalObject->requireResolveFunctionUnbound(),
        moduleObject,
        ArgList(), 1, jsString(vm, String("require"_s)));

    requireFunction->putDirect(vm, builtinNames.resolvePublicName(), resolveFunction, PropertyAttribute::Function | 0);

    return requireFunction;
}

} // namespace Bun
