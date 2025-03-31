#include "root.h"

#include "JavaScriptCore/PropertySlot.h"
#include "JavaScriptCore/ExecutableInfo.h"
#include "JavaScriptCore/WriteBarrierInlines.h"
#include "ErrorCode.h"
#include <JavaScriptCore/SourceOrigin.h>
#include <JavaScriptCore/SourceProvider.h>

#include "BunClientData.h"
#include "NodeVM.h"
#include "JavaScriptCore/JSObjectInlines.h"
#include "wtf/text/ExternalStringImpl.h"

#include "JavaScriptCore/FunctionPrototype.h"
#include "JavaScriptCore/FunctionConstructor.h"
#include "JavaScriptCore/HeapAnalyzer.h"

#include "JavaScriptCore/JSDestructibleObjectHeapCellType.h"
#include "JavaScriptCore/SlotVisitorMacros.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/SubspaceInlines.h"
#include "wtf/GetPtr.h"
#include "wtf/PointerPreparations.h"
#include "wtf/URL.h"
#include "JavaScriptCore/TypedArrayInlines.h"
#include "JavaScriptCore/PropertyNameArray.h"
#include "JavaScriptCore/JSWeakMap.h"
#include "JavaScriptCore/JSWeakMapInlines.h"
#include "JavaScriptCore/JSWithScope.h"
#include "JavaScriptCore/JSGlobalProxyInlines.h"
#include "GCDefferalContext.h"
#include "JSBuffer.h"

#include <JavaScriptCore/DOMJITAbstractHeap.h>
#include <JavaScriptCore/DFGAbstractHeap.h>
#include <JavaScriptCore/Completion.h>
#include "JavaScriptCore/LazyClassStructureInlines.h"
#include "JavaScriptCore/Parser.h"
#include "JavaScriptCore/SourceCodeKey.h"
#include "JavaScriptCore/UnlinkedFunctionExecutable.h"
#include "NodeValidator.h"

#include "JavaScriptCore/JSCInlines.h"

namespace Bun {
using namespace WebCore;

/// For vm.compileFunction we need to return an anonymous function expression
///
/// This code is adapted/inspired from JSC::constructFunction, which is used for function declarations.
static JSC::JSFunction* constructAnonymousFunction(JSC::JSGlobalObject* globalObject, const ArgList& args, const SourceOrigin& sourceOrigin, const String& fileName = String(), JSC::SourceTaintedOrigin sourceTaintOrigin = JSC::SourceTaintedOrigin::Untainted, TextPosition position = TextPosition(), JSC::JSScope* scope = nullptr);
static String stringifyAnonymousFunction(JSGlobalObject* globalObject, const ArgList& args, ThrowScope& scope, int* outOffset);

NodeVMGlobalObject* createContextImpl(JSC::VM& vm, JSGlobalObject* globalObject, JSObject* sandbox);

/// For some reason Node has this error message with a grammar error and we have to match it so the tests pass:
/// `The "<name>" argument must be an vm.Context`
JSC::EncodedJSValue INVALID_ARG_VALUE_VM_VARIATION(JSC::ThrowScope& throwScope, JSC::JSGlobalObject* globalObject, WTF::ASCIILiteral name, JSC::JSValue value)
{
    WTF::StringBuilder builder;
    builder.append("The \""_s);
    builder.append(name);
    builder.append("\" argument must be an vm.Context"_s);

    throwScope.throwException(globalObject, createError(globalObject, ErrorCode::ERR_INVALID_ARG_TYPE, builder.toString()));
    return {};
}

class NodeVMScriptConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;

    static NodeVMScriptConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSC::JSObject* prototype);

    DECLARE_EXPORT_INFO;

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, Base::StructureFlags), info());
    }

private:
    NodeVMScriptConstructor(JSC::VM& vm, JSC::Structure* structure);

    void finishCreation(JSC::VM&, JSC::JSObject* prototype);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(NodeVMScriptConstructor, JSC::InternalFunction);

class NodeVMScript final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;

    static NodeVMScript* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSC::SourceCode source);

    DECLARE_EXPORT_INFO;
    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<NodeVMScript, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForNodeVMScript.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForNodeVMScript = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForNodeVMScript.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForNodeVMScript = std::forward<decltype(space)>(space); });
    }

    static void destroy(JSC::JSCell*);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static JSObject* createPrototype(VM& vm, JSGlobalObject* globalObject);

    const JSC::SourceCode& source() const { return m_source; }

    DECLARE_VISIT_CHILDREN;
    mutable JSC::WriteBarrier<JSC::DirectEvalExecutable> m_cachedDirectExecutable;

private:
    JSC::SourceCode m_source;

    NodeVMScript(JSC::VM& vm, JSC::Structure* structure, JSC::SourceCode source)
        : Base(vm, structure)
        , m_source(source)
    {
    }

    void finishCreation(JSC::VM&);
};

NodeVMGlobalObject::NodeVMGlobalObject(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure)
{
}

template<typename, JSC::SubspaceAccess mode> JSC::GCClient::IsoSubspace* NodeVMGlobalObject::subspaceFor(JSC::VM& vm)
{
    if constexpr (mode == JSC::SubspaceAccess::Concurrently)
        return nullptr;
    return WebCore::subspaceForImpl<NodeVMGlobalObject, WebCore::UseCustomHeapCellType::Yes>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForNodeVMGlobalObject.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForNodeVMGlobalObject = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForNodeVMGlobalObject.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForNodeVMGlobalObject = std::forward<decltype(space)>(space); },
        [](auto& server) -> JSC::HeapCellType& { return server.m_heapCellTypeForNodeVMGlobalObject; });
}

NodeVMGlobalObject* NodeVMGlobalObject::create(JSC::VM& vm, JSC::Structure* structure)
{
    auto* cell = new (NotNull, JSC::allocateCell<NodeVMGlobalObject>(vm)) NodeVMGlobalObject(vm, structure);
    cell->finishCreation(vm);
    return cell;
}

Structure* NodeVMGlobalObject::createStructure(JSC::VM& vm, JSC::JSValue prototype)
{
    // ~IsImmutablePrototypeExoticObject is necessary for JSDOM to work (it relies on __proto__ = on the GlobalObject).
    return JSC::Structure::create(vm, nullptr, prototype, JSC::TypeInfo(JSC::GlobalObjectType, StructureFlags & ~IsImmutablePrototypeExoticObject), info());
}

void NodeVMGlobalObject::finishCreation(JSC::VM&)
{
    Base::finishCreation(vm());
}

void NodeVMGlobalObject::destroy(JSCell* cell)
{
    static_cast<NodeVMGlobalObject*>(cell)->~NodeVMGlobalObject();
}

NodeVMGlobalObject::~NodeVMGlobalObject()
{
}

void NodeVMGlobalObject::setContextifiedObject(JSC::JSObject* contextifiedObject)
{
    m_sandbox.set(vm(), this, contextifiedObject);
}

void NodeVMGlobalObject::clearContextifiedObject()
{
    m_sandbox.clear();
}

bool NodeVMGlobalObject::put(JSCell* cell, JSGlobalObject* globalObject, PropertyName propertyName, JSValue value, PutPropertySlot& slot)
{
    // if (!propertyName.isSymbol())
    //     printf("put called for %s\n", propertyName.publicName()->utf8().data());
    auto* thisObject = jsCast<NodeVMGlobalObject*>(cell);

    if (!thisObject->m_sandbox) {
        return Base::put(cell, globalObject, propertyName, value, slot);
    }

    auto* sandbox = thisObject->m_sandbox.get();

    auto& vm = JSC::getVM(globalObject);
    JSValue thisValue = slot.thisValue();
    bool isContextualStore = thisValue != JSValue(globalObject);
    (void)isContextualStore;
    bool isDeclaredOnGlobalObject = slot.type() == JSC::PutPropertySlot::NewProperty;
    auto scope = DECLARE_THROW_SCOPE(vm);
    PropertySlot getter(sandbox, PropertySlot::InternalMethodType::Get, nullptr);
    bool isDeclaredOnSandbox = sandbox->getPropertySlot(globalObject, propertyName, getter);
    RETURN_IF_EXCEPTION(scope, false);

    bool isDeclared = isDeclaredOnGlobalObject || isDeclaredOnSandbox;
    bool isFunction = value.isCallable();

    if (slot.isStrictMode() && !isDeclared && isContextualStore && !isFunction) {
        return Base::put(cell, globalObject, propertyName, value, slot);
    }

    if (!isDeclared && value.isSymbol()) {
        return Base::put(cell, globalObject, propertyName, value, slot);
    }

    slot.setThisValue(sandbox);

    if (!sandbox->methodTable()->put(sandbox, globalObject, propertyName, value, slot)) {
        return false;
    }
    RETURN_IF_EXCEPTION(scope, false);

    if (isDeclaredOnSandbox && getter.isAccessor() and (getter.attributes() & PropertyAttribute::DontEnum) == 0) {
        return true;
    }

    slot.setThisValue(thisValue);

    return Base::put(cell, globalObject, propertyName, value, slot);
}

// This is copy-pasted from JSC's ProxyObject.cpp
static const ASCIILiteral s_proxyAlreadyRevokedErrorMessage { "Proxy has already been revoked. No more operations are allowed to be performed on it"_s };

bool NodeVMGlobalObject::getOwnPropertySlot(JSObject* cell, JSGlobalObject* globalObject, PropertyName propertyName, PropertySlot& slot)
{
    // if (!propertyName.isSymbol())
    //     printf("getOwnPropertySlot called for %s\n", propertyName.publicName()->utf8().data());

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* thisObject = jsCast<NodeVMGlobalObject*>(cell);
    if (thisObject->m_sandbox) {
        auto* contextifiedObject = thisObject->m_sandbox.get();
        slot.setThisValue(contextifiedObject);
        // Unfortunately we must special case ProxyObjects. Why?
        //
        // When we run this:
        //
        // ```js
        // vm.runInNewContext("String", new Proxy({}, {}))
        // ```
        //
        // It always returns undefined (it should return the String constructor function).
        //
        // This is because JSC seems to always return true when calling
        // `contextifiedObject->methodTable()->getOwnPropertySlot` for ProxyObjects, so
        // we never fall through to call `Base::getOwnPropertySlot` to fetch it from the globalObject.
        //
        // This only happens when `slot.internalMethodType() == JSC::PropertySlot::InternalMethodType::Get`
        // and there is no `get` trap set on the proxy object.
        if (slot.internalMethodType() == JSC::PropertySlot::InternalMethodType::Get && contextifiedObject->type() == JSC::ProxyObjectType) {
            JSC::ProxyObject* proxyObject = jsCast<JSC::ProxyObject*>(contextifiedObject);

            JSValue handlerValue = proxyObject->handler();
            if (handlerValue.isNull())
                return throwTypeError(globalObject, scope, s_proxyAlreadyRevokedErrorMessage);

            JSObject* handler = jsCast<JSObject*>(handlerValue);
            CallData callData;
            JSObject* getHandler = proxyObject->getHandlerTrap(globalObject, handler, callData, vm.propertyNames->get, ProxyObject::HandlerTrap::Get);
            RETURN_IF_EXCEPTION(scope, {});

            // If there is a `get` trap, we don't need to our special handling
            if (getHandler) {
                if (contextifiedObject->methodTable()->getOwnPropertySlot(contextifiedObject, globalObject, propertyName, slot)) {
                    return true;
                }
                goto try_from_global;
            }

            // A lot of this is copy-pasted from JSC's `ProxyObject::getOwnPropertySlotCommon` function in
            // ProxyObject.cpp, need to make sure we keep this in sync when we update JSC...

            slot.disableCaching();
            slot.setIsTaintedByOpaqueObject();

            if (slot.isVMInquiry()) {
                goto try_from_global;
            }

            JSValue receiver = slot.thisValue();

            // We're going to have to look this up ourselves
            PropertySlot target_slot(receiver, PropertySlot::InternalMethodType::Get);
            JSObject* target = proxyObject->target();
            bool hasProperty = target->getPropertySlot(globalObject, propertyName, target_slot);
            EXCEPTION_ASSERT(!scope.exception() || !hasProperty);
            if (hasProperty) {
                unsigned ignoredAttributes = 0;
                JSValue result = target_slot.getValue(globalObject, propertyName);
                RETURN_IF_EXCEPTION(scope, {});
                slot.setValue(proxyObject, ignoredAttributes, result);
                RETURN_IF_EXCEPTION(scope, {});
                return true;
            }

            goto try_from_global;
        }

        if (contextifiedObject->getPropertySlot(globalObject, propertyName, slot)) {
            return true;
        }

    try_from_global:

        slot.setThisValue(globalObject);
        RETURN_IF_EXCEPTION(scope, false);
    }

    return Base::getOwnPropertySlot(cell, globalObject, propertyName, slot);
}

bool NodeVMGlobalObject::defineOwnProperty(JSObject* cell, JSGlobalObject* globalObject, PropertyName propertyName, const PropertyDescriptor& descriptor, bool shouldThrow)
{
    // if (!propertyName.isSymbol())
    //     printf("defineOwnProperty called for %s\n", propertyName.publicName()->utf8().data());
    auto* thisObject = jsCast<NodeVMGlobalObject*>(cell);
    if (!thisObject->m_sandbox) {
        return Base::defineOwnProperty(cell, globalObject, propertyName, descriptor, shouldThrow);
    }

    auto* contextifiedObject = thisObject->m_sandbox.get();
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    PropertySlot slot(globalObject, PropertySlot::InternalMethodType::GetOwnProperty, nullptr);
    bool isDeclaredOnGlobalProxy = globalObject->JSC::JSGlobalObject::getOwnPropertySlot(globalObject, globalObject, propertyName, slot);

    // If the property is set on the global as neither writable nor
    // configurable, don't change it on the global or sandbox.
    if (isDeclaredOnGlobalProxy && (slot.attributes() & PropertyAttribute::ReadOnly) != 0 && (slot.attributes() & PropertyAttribute::DontDelete) != 0) {
        return Base::defineOwnProperty(cell, globalObject, propertyName, descriptor, shouldThrow);
    }

    if (descriptor.isAccessorDescriptor()) {
        return contextifiedObject->defineOwnProperty(contextifiedObject, contextifiedObject->globalObject(), propertyName, descriptor, shouldThrow);
    }

    bool isDeclaredOnSandbox = contextifiedObject->getPropertySlot(globalObject, propertyName, slot);
    RETURN_IF_EXCEPTION(scope, false);

    if (isDeclaredOnSandbox && !isDeclaredOnGlobalProxy) {
        return contextifiedObject->defineOwnProperty(contextifiedObject, contextifiedObject->globalObject(), propertyName, descriptor, shouldThrow);
    }

    if (!contextifiedObject->defineOwnProperty(contextifiedObject, contextifiedObject->globalObject(), propertyName, descriptor, shouldThrow)) {
        return false;
    }

    return Base::defineOwnProperty(cell, globalObject, propertyName, descriptor, shouldThrow);
}

DEFINE_VISIT_CHILDREN(NodeVMGlobalObject);

template<typename Visitor>
void NodeVMGlobalObject::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    Base::visitChildren(cell, visitor);
    auto* thisObject = jsCast<NodeVMGlobalObject*>(cell);
    visitor.append(thisObject->m_sandbox);
}

class BaseOptions {
public:
    String filename = String();
    OrdinalNumber lineOffset;
    OrdinalNumber columnOffset;
    bool failed;

    bool fromJS(JSC::JSGlobalObject* globalObject, JSC::VM& vm, JSC::ThrowScope& scope, JSC::JSValue optionsArg)
    {
        JSObject* options = nullptr;
        bool any = false;

        if (!optionsArg.isUndefined()) {
            if (optionsArg.isObject()) {
                options = asObject(optionsArg);
            } else {
                auto _ = ERR::INVALID_ARG_TYPE(scope, globalObject, "options"_s, "object"_s, optionsArg);
                return false;
            }

            if (JSValue filenameOpt = options->getIfPropertyExists(globalObject, builtinNames(vm).filenamePublicName())) {
                if (filenameOpt.isString()) {
                    this->filename = filenameOpt.toWTFString(globalObject);
                    RETURN_IF_EXCEPTION(scope, false);
                    any = true;
                } else if (!filenameOpt.isUndefined()) {
                    ERR::INVALID_ARG_TYPE(scope, globalObject, "options.filename"_s, "string"_s, filenameOpt);
                    return false;
                }
            } else {
                this->filename = "evalmachine.<anonymous>"_s;
            }

            if (JSValue lineOffsetOpt = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "lineOffset"_s))) {
                if (lineOffsetOpt.isAnyInt()) {
                    if (!lineOffsetOpt.isInt32()) {
                        ERR::OUT_OF_RANGE(scope, globalObject, "options.lineOffset"_s, std::numeric_limits<int32_t>().min(), std::numeric_limits<int32_t>().max(), lineOffsetOpt);
                        return false;
                    }
                    this->lineOffset = OrdinalNumber::fromZeroBasedInt(lineOffsetOpt.asInt32());
                    any = true;
                } else if (lineOffsetOpt.isNumber()) {
                    ERR::OUT_OF_RANGE(scope, globalObject, "options.lineOffset"_s, "an integer"_s, lineOffsetOpt);
                    return false;
                } else if (!lineOffsetOpt.isUndefined()) {
                    ERR::INVALID_ARG_TYPE(scope, globalObject, "options.lineOffset"_s, "number"_s, lineOffsetOpt);
                    return false;
                }
            }

            if (JSValue columnOffsetOpt = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "columnOffset"_s))) {
                if (columnOffsetOpt.isAnyInt()) {
                    if (!columnOffsetOpt.isInt32()) {
                        ERR::OUT_OF_RANGE(scope, globalObject, "options.columnOffset"_s, std::numeric_limits<int32_t>().min(), std::numeric_limits<int32_t>().max(), columnOffsetOpt);
                        return false;
                    }
                    int columnOffsetValue = columnOffsetOpt.asInt32();

                    this->columnOffset = OrdinalNumber::fromZeroBasedInt(columnOffsetValue);
                    any = true;
                } else if (columnOffsetOpt.isNumber()) {
                    ERR::OUT_OF_RANGE(scope, globalObject, "options.columnOffset"_s, "an integer"_s, columnOffsetOpt);
                    return false;
                } else if (!columnOffsetOpt.isUndefined()) {
                    ERR::INVALID_ARG_TYPE(scope, globalObject, "options.columnOffset"_s, "number"_s, columnOffsetOpt);
                    return false;
                }
            }
        }

        return any;
    }

    bool validateProduceCachedData(JSC::JSGlobalObject* globalObject, JSC::VM& vm, JSC::ThrowScope& scope, JSObject* options, bool* outProduceCachedData)
    {
        JSValue produceCachedDataOpt = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "produceCachedData"_s));
        if (produceCachedDataOpt && !produceCachedDataOpt.isUndefined()) {
            RETURN_IF_EXCEPTION(scope, {});
            if (!produceCachedDataOpt.isBoolean()) {
                ERR::INVALID_ARG_TYPE(scope, globalObject, "options.produceCachedData"_s, "boolean"_s, produceCachedDataOpt);
                return false;
            }
            *outProduceCachedData = produceCachedDataOpt.asBoolean();
            return true;
        }
        return false;
    }

    bool validateCachedData(JSC::JSGlobalObject* globalObject, JSC::VM& vm, JSC::ThrowScope& scope, JSObject* options)
    {
        JSValue cachedDataOpt = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "cachedData"_s));
        if (cachedDataOpt && !cachedDataOpt.isUndefined()) {
            RETURN_IF_EXCEPTION(scope, {});
            if (!cachedDataOpt.isCell()) {
                ERR::INVALID_ARG_INSTANCE(scope, globalObject, "options.cachedData"_s, "Buffer, TypedArray, or DataView"_s, cachedDataOpt);
                return false;
            }

            // If it's a cell, verify it's a Buffer, TypedArray, or DataView
            if (cachedDataOpt.isCell()) {
                JSCell* cell = cachedDataOpt.asCell();
                bool isValidType = false;

                // Check if it's a Buffer, TypedArray, or DataView
                if (cell->inherits<JSC::JSArrayBufferView>() || cell->inherits<JSC::JSArrayBuffer>()) {
                    isValidType = true;
                } else if (JSC::JSArrayBufferView* view = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(cachedDataOpt)) {
                    isValidType = !view->isDetached();
                }

                if (!isValidType) {
                    ERR::INVALID_ARG_INSTANCE(scope, globalObject, "options.cachedData"_s, "Buffer, TypedArray, or DataView"_s, cachedDataOpt);
                    return false;
                }
                return true;

                // TODO: actually use it
                // this->cachedData = true;
            }
        }
        return false;
    }

    bool validateTimeout(JSC::JSGlobalObject* globalObject, JSC::VM& vm, JSC::ThrowScope& scope, JSObject* options, std::optional<int64_t>* outTimeout)
    {
        JSValue timeoutOpt = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "timeout"_s));
        if (timeoutOpt && !timeoutOpt.isUndefined()) {
            if (!timeoutOpt.isNumber()) {
                ERR::INVALID_ARG_TYPE(scope, globalObject, "options.timeout"_s, "number"_s, timeoutOpt);
                return false;
            }

            ssize_t timeoutValue;
            V::validateInteger(scope, globalObject, timeoutOpt, "options.timeout"_s, jsNumber(1), jsNumber(std::numeric_limits<int64_t>().max()), &timeoutValue);
            RETURN_IF_EXCEPTION(scope, {});

            *outTimeout = timeoutValue;
            return true;
        }
        return false;
    }
};

class ScriptOptions : public BaseOptions {
public:
    bool importModuleDynamically = false;
    std::optional<int64_t> timeout = std::nullopt;
    bool cachedData = false;
    bool produceCachedData = false;

    bool fromJS(JSC::JSGlobalObject* globalObject, JSC::VM& vm, JSC::ThrowScope& scope, JSC::JSValue optionsArg)
    {
        bool any = BaseOptions::fromJS(globalObject, vm, scope, optionsArg);
        RETURN_IF_EXCEPTION(scope, false);

        if (!optionsArg.isUndefined() && !optionsArg.isString()) {
            JSObject* options = asObject(optionsArg);

            // Validate contextName and contextOrigin are strings
            if (JSValue contextNameOpt = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "contextName"_s))) {
                if (!contextNameOpt.isUndefined() && !contextNameOpt.isString()) {
                    ERR::INVALID_ARG_TYPE(scope, globalObject, "options.contextName"_s, "string"_s, contextNameOpt);
                    return false;
                }
                any = true;
            }

            if (JSValue contextOriginOpt = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "contextOrigin"_s))) {
                if (!contextOriginOpt.isUndefined() && !contextOriginOpt.isString()) {
                    ERR::INVALID_ARG_TYPE(scope, globalObject, "options.contextOrigin"_s, "string"_s, contextOriginOpt);
                    return false;
                }
                any = true;
            }

            if (validateTimeout(globalObject, vm, scope, options, &this->timeout)) {
                RETURN_IF_EXCEPTION(scope, false);
                any = true;
            }

            if (validateProduceCachedData(globalObject, vm, scope, options, &this->produceCachedData)) {
                RETURN_IF_EXCEPTION(scope, false);
                any = true;
            }

            if (validateCachedData(globalObject, vm, scope, options)) {
                RETURN_IF_EXCEPTION(scope, false);
                any = true;
                // TODO: actually use it
                this->cachedData = true;
            }
        }

        return any;
    }
};

class RunningScriptOptions : public BaseOptions {
public:
    bool displayErrors = true;
    std::optional<int64_t> timeout = std::nullopt;
    bool breakOnSigint = false;

    bool fromJS(JSC::JSGlobalObject* globalObject, JSC::VM& vm, JSC::ThrowScope& scope, JSC::JSValue optionsArg)
    {
        bool any = BaseOptions::fromJS(globalObject, vm, scope, optionsArg);
        RETURN_IF_EXCEPTION(scope, false);

        if (!optionsArg.isUndefined() && !optionsArg.isString()) {
            JSObject* options = asObject(optionsArg);

            if (JSValue displayErrorsOpt = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "displayErrors"_s))) {
                RETURN_IF_EXCEPTION(scope, false);
                if (!displayErrorsOpt.isBoolean()) {
                    ERR::INVALID_ARG_TYPE(scope, globalObject, "options.displayErrors"_s, "boolean"_s, displayErrorsOpt);
                    return false;
                }
                this->displayErrors = displayErrorsOpt.asBoolean();
                any = true;
            }

            if (validateTimeout(globalObject, vm, scope, options, &this->timeout)) {
                RETURN_IF_EXCEPTION(scope, false);
                any = true;
            }

            if (JSValue breakOnSigintOpt = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "breakOnSigint"_s))) {
                RETURN_IF_EXCEPTION(scope, false);
                if (!breakOnSigintOpt.isBoolean()) {
                    ERR::INVALID_ARG_TYPE(scope, globalObject, "options.breakOnSigint"_s, "boolean"_s, breakOnSigintOpt);
                    return false;
                }
                this->breakOnSigint = breakOnSigintOpt.asBoolean();
                any = true;
            }
        }

        return any;
    }
};

class CompileFunctionOptions : public BaseOptions {
public:
    bool cachedData = false;
    bool produceCachedData;
    JSGlobalObject* parsingContext;
    JSValue contextExtensions;

    bool fromJS(JSC::JSGlobalObject* globalObject, JSC::VM& vm, JSC::ThrowScope& scope, JSC::JSValue optionsArg)
    {
        this->parsingContext = globalObject;
        bool any = BaseOptions::fromJS(globalObject, vm, scope, optionsArg);
        RETURN_IF_EXCEPTION(scope, false);

        if (!optionsArg.isUndefined() && !optionsArg.isString()) {
            JSObject* options = asObject(optionsArg);

            if (validateProduceCachedData(globalObject, vm, scope, options, &this->produceCachedData)) {
                RETURN_IF_EXCEPTION(scope, false);
                any = true;
            }

            if (validateCachedData(globalObject, vm, scope, options)) {
                RETURN_IF_EXCEPTION(scope, false);
                any = true;
                // TODO: actually use it
                this->cachedData = true;
            }

            JSValue parsingContextValue = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "parsingContext"_s));
            RETURN_IF_EXCEPTION(scope, {});

            if (!parsingContextValue.isEmpty() && !parsingContextValue.isUndefined()) {
                if (parsingContextValue.isNull() || !parsingContextValue.isObject())
                    return ERR::INVALID_ARG_INSTANCE(scope, globalObject, "options.parsingContext"_s, "Context"_s, parsingContextValue);

                JSObject* context = asObject(parsingContextValue);
                auto* zigGlobalObject = defaultGlobalObject(globalObject);
                JSValue scopeValue = zigGlobalObject->vmModuleContextMap()->get(context);

                if (scopeValue.isUndefined())
                    return ERR::INVALID_ARG_INSTANCE(scope, globalObject, "options.parsingContext"_s, "Context"_s, parsingContextValue);

                parsingContext = jsDynamicCast<NodeVMGlobalObject*>(scopeValue);
                if (!parsingContext)
                    return ERR::INVALID_ARG_INSTANCE(scope, globalObject, "options.parsingContext"_s, "Context"_s, parsingContextValue);

                any = true;
            }

            // Handle contextExtensions option
            JSValue contextExtensionsValue = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "contextExtensions"_s));
            RETURN_IF_EXCEPTION(scope, {});

            if (!contextExtensionsValue.isEmpty() && !contextExtensionsValue.isUndefined()) {
                if (contextExtensionsValue.isNull() || !contextExtensionsValue.isObject())
                    return ERR::INVALID_ARG_INSTANCE(scope, globalObject, "options.contextExtensions"_s, "Array"_s, contextExtensionsValue);

                if (auto* contextExtensionsObject = asObject(contextExtensionsValue)) {
                    if (!isArray(globalObject, contextExtensionsObject))
                        return ERR::INVALID_ARG_TYPE(scope, globalObject, "options.contextExtensions"_s, "Array"_s, contextExtensionsValue);

                    // Validate that all items in the array are objects
                    auto* contextExtensionsArray = jsCast<JSArray*>(contextExtensionsValue);
                    unsigned length = contextExtensionsArray->length();
                    for (unsigned i = 0; i < length; i++) {
                        JSValue extension = contextExtensionsArray->getIndexQuickly(i);
                        if (!extension.isObject())
                            return ERR::INVALID_ARG_TYPE(scope, globalObject, "options.contextExtensions[0]"_s, "object"_s, extension);
                    }
                } else {
                    return ERR::INVALID_ARG_TYPE(scope, globalObject, "options.contextExtensions"_s, "Array"_s, contextExtensionsValue);
                }

                this->contextExtensions = contextExtensionsValue;
                any = true;
            }
        }

        return any;
    }
};

static EncodedJSValue
constructScript(JSGlobalObject* globalObject, CallFrame* callFrame, JSValue newTarget = JSValue())
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    ArgList args(callFrame);
    JSValue sourceArg = args.at(0);
    String sourceString = sourceArg.isUndefined() ? emptyString() : sourceArg.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, encodedJSUndefined());

    JSValue optionsArg = args.at(1);
    ScriptOptions options;
    if (optionsArg.isString()) {
        options.filename = optionsArg.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    } else if (!options.fromJS(globalObject, vm, scope, optionsArg)) {
        RETURN_IF_EXCEPTION(scope, JSValue::encode(jsUndefined()));
        options = {};
    }

    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    Structure* structure = zigGlobalObject->NodeVMScriptStructure();
    if (UNLIKELY(zigGlobalObject->NodeVMScript() != newTarget)) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (!newTarget) {
            throwTypeError(globalObject, scope, "Class constructor Script cannot be invoked without 'new'"_s);
            return {};
        }

        auto* functionGlobalObject = defaultGlobalObject(getFunctionRealm(globalObject, newTarget.getObject()));
        RETURN_IF_EXCEPTION(scope, {});
        structure = InternalFunction::createSubclassStructure(
            globalObject, newTarget.getObject(), functionGlobalObject->NodeVMScriptStructure());
        scope.release();
    }

    SourceCode source(
        JSC::StringSourceProvider::create(sourceString, JSC::SourceOrigin(WTF::URL::fileURLWithFileSystemPath(options.filename)), options.filename, JSC::SourceTaintedOrigin::Untainted, TextPosition(options.lineOffset, options.columnOffset)),
        options.lineOffset.zeroBasedInt(), options.columnOffset.zeroBasedInt());
    RETURN_IF_EXCEPTION(scope, {});
    NodeVMScript* script = NodeVMScript::create(vm, globalObject, structure, source);
    return JSValue::encode(JSValue(script));
}

static bool handleException(JSGlobalObject* globalObject, VM& vm, NakedPtr<Exception> exception, ThrowScope& throwScope)
{
    if (auto* errorInstance = jsDynamicCast<ErrorInstance*>(exception->value())) {
        errorInstance->materializeErrorInfoIfNeeded(vm, vm.propertyNames->stack);
        RETURN_IF_EXCEPTION(throwScope, {});
        JSValue stack_jsval = errorInstance->get(globalObject, vm.propertyNames->stack);
        RETURN_IF_EXCEPTION(throwScope, {});
        if (!stack_jsval.isString()) {
            return false;
        }
        String stack = stack_jsval.toWTFString(globalObject);

        auto& e_stack = exception->stack();
        size_t stack_size = e_stack.size();
        if (stack_size == 0) {
            return false;
        }
        auto& stack_frame = e_stack[0];
        auto source_url = stack_frame.sourceURL(vm);
        if (source_url.isEmpty()) {
            // copy what Node does: https://github.com/nodejs/node/blob/afe3909483a2d5ae6b847055f544da40571fb28d/lib/vm.js#L94
            source_url = "evalmachine.<anonymous>"_s;
        }
        auto line_and_column = stack_frame.computeLineAndColumn();

        String prepend = makeString(source_url, ":"_s, line_and_column.line, "\n"_s, stack);
        errorInstance->putDirect(vm, vm.propertyNames->stack, jsString(vm, prepend), JSC::PropertyAttribute::DontEnum | 0);

        JSC::throwException(globalObject, throwScope, exception.get());
        return true;
    }
    return false;
}

static JSC::EncodedJSValue runInContext(NodeVMGlobalObject* globalObject, NodeVMScript* script, JSObject* contextifiedObject, JSValue optionsArg, bool allowStringInPlaceOfOptions = false)
{

    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    RunningScriptOptions options;
    if (allowStringInPlaceOfOptions && optionsArg.isString()) {
        options.filename = optionsArg.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(throwScope, {});
    } else if (!options.fromJS(globalObject, vm, throwScope, optionsArg)) {
        RETURN_IF_EXCEPTION(throwScope, {});
        options = {};
    }

    // Set the contextified object before evaluating
    globalObject->setContextifiedObject(contextifiedObject);

    NakedPtr<Exception> exception;
    JSValue result = JSC::evaluate(globalObject, script->source(), globalObject, exception);

    if (UNLIKELY(exception)) {
        if (handleException(globalObject, vm, exception, throwScope)) {
            return {};
        }
        JSC::throwException(globalObject, throwScope, exception.get());
        return {};
    }

    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(scriptConstructorCall, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return constructScript(globalObject, callFrame);
}

JSC_DEFINE_HOST_FUNCTION(scriptConstructorConstruct, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return constructScript(globalObject, callFrame, callFrame->newTarget());
}

JSC_DEFINE_CUSTOM_GETTER(scriptGetCachedDataRejected, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    return JSValue::encode(jsBoolean(true)); // TODO
}
JSC_DEFINE_HOST_FUNCTION(scriptCreateCachedData, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    return throwVMError(globalObject, scope, "TODO: Script.createCachedData"_s);
}

JSC_DEFINE_HOST_FUNCTION(scriptRunInContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue thisValue = callFrame->thisValue();
    auto* script = jsDynamicCast<NodeVMScript*>(thisValue);
    if (UNLIKELY(!script)) {
        return ERR::INVALID_ARG_VALUE(scope, globalObject, "this"_s, thisValue, "must be a Script"_s);
    }

    ArgList args(callFrame);
    JSValue contextArg = args.at(0);
    if (contextArg.isUndefinedOrNull()) {
        return ERR::INVALID_ARG_TYPE(scope, globalObject, "context"_s, "object"_s, contextArg);
    }

    if (!contextArg.isObject()) {
        return ERR::INVALID_ARG_TYPE(scope, globalObject, "context"_s, "object"_s, contextArg);
    }

    JSObject* context = asObject(contextArg);
    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    JSValue scopeValue = zigGlobalObject->vmModuleContextMap()->get(context);
    if (scopeValue.isUndefined()) {
        return INVALID_ARG_VALUE_VM_VARIATION(scope, globalObject, "contextifiedObject"_s, context);
    }

    NodeVMGlobalObject* nodeVmGlobalObject = jsDynamicCast<NodeVMGlobalObject*>(scopeValue);
    if (!nodeVmGlobalObject) {
        return INVALID_ARG_VALUE_VM_VARIATION(scope, globalObject, "contextifiedObject"_s, context);
    }

    return runInContext(nodeVmGlobalObject, script, context, args.at(1));
}

JSC_DEFINE_HOST_FUNCTION(scriptRunInThisContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    JSValue thisValue = callFrame->thisValue();
    auto* script = jsDynamicCast<NodeVMScript*>(thisValue);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (UNLIKELY(!script)) {
        return ERR::INVALID_ARG_VALUE(throwScope, globalObject, "this"_s, thisValue, "must be a Script"_s);
    }

    JSValue contextArg = callFrame->argument(0);
    if (contextArg.isUndefined()) {
        contextArg = JSC::constructEmptyObject(globalObject);
    }

    if (!contextArg.isObject()) {
        return ERR::INVALID_ARG_TYPE(throwScope, globalObject, "context"_s, "object"_s, contextArg);
    }

    RunningScriptOptions options;
    if (!options.fromJS(globalObject, vm, throwScope, contextArg)) {
        RETURN_IF_EXCEPTION(throwScope, {});
        options = {};
    }

    NakedPtr<Exception> exception;
    JSValue result = JSC::evaluate(globalObject, script->source(), globalObject, exception);

    if (UNLIKELY(exception)) {
        if (handleException(globalObject, vm, exception, throwScope)) {
            return {};
        }
        JSC::throwException(globalObject, throwScope, exception.get());
        return {};
    }

    RETURN_IF_EXCEPTION(throwScope, {});
    return JSValue::encode(result);
}

JSC_DEFINE_CUSTOM_GETTER(scriptGetSourceMapURL, (JSGlobalObject * globalObject, JSC::EncodedJSValue thisValueEncoded, PropertyName))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue thisValue = JSValue::decode(thisValueEncoded);
    auto* script = jsDynamicCast<NodeVMScript*>(thisValue);
    if (UNLIKELY(!script)) {
        return ERR::INVALID_ARG_VALUE(scope, globalObject, "this"_s, thisValue, "must be a Script"_s);
    }

    const auto& url = script->source().provider()->sourceMappingURLDirective();
    return JSValue::encode(jsString(vm, url));
}

JSC_DEFINE_HOST_FUNCTION(vmModuleRunInNewContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue code = callFrame->argument(0);
    if (!code.isString())
        return ERR::INVALID_ARG_TYPE(scope, globalObject, "code"_s, "string"_s, code);

    JSValue contextArg = callFrame->argument(1);
    if (contextArg.isUndefined()) {
        contextArg = JSC::constructEmptyObject(globalObject);
    }

    if (!contextArg.isObject())
        return ERR::INVALID_ARG_TYPE(scope, globalObject, "context"_s, "object"_s, contextArg);

    JSObject* sandbox = asObject(contextArg);

    // Create context and run code
    auto* context = NodeVMGlobalObject::create(vm,
        defaultGlobalObject(globalObject)->NodeVMGlobalObjectStructure());

    context->setContextifiedObject(sandbox);

    JSValue optionsArg = callFrame->argument(2);

    ScriptOptions options;
    if (optionsArg.isString()) {
        options.filename = optionsArg.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
    } else if (!options.fromJS(globalObject, vm, scope, optionsArg)) {
        RETURN_IF_EXCEPTION(scope, {});
        options = {};
    }

    auto sourceCode = SourceCode(
        JSC::StringSourceProvider::create(
            code.toString(globalObject)->value(globalObject),
            JSC::SourceOrigin(WTF::URL::fileURLWithFileSystemPath(options.filename)),
            options.filename,
            JSC::SourceTaintedOrigin::Untainted,
            TextPosition(options.lineOffset, options.columnOffset)),
        options.lineOffset.zeroBasedInt(),
        options.columnOffset.zeroBasedInt());

    NakedPtr<Exception> exception;
    JSValue result = JSC::evaluate(context, sourceCode, context, exception);

    if (UNLIKELY(exception)) {
        if (handleException(globalObject, vm, exception, scope)) {
            return {};
        }
        JSC::throwException(globalObject, scope, exception.get());
        return {};
    }

    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(vmModuleRunInThisContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto sourceStringValue = callFrame->argument(0);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (!sourceStringValue.isString()) {
        return ERR::INVALID_ARG_TYPE(throwScope, globalObject, "code"_s, "string"_s, sourceStringValue);
    }

    auto sourceString = sourceStringValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, encodedJSUndefined());

    JSValue optionsArg = callFrame->argument(1);
    ScriptOptions options;
    if (optionsArg.isString()) {
        options.filename = optionsArg.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(throwScope, {});
    } else if (!options.fromJS(globalObject, vm, throwScope, optionsArg)) {
        RETURN_IF_EXCEPTION(throwScope, encodedJSUndefined());
        options = {};
    }

    SourceCode source(
        JSC::StringSourceProvider::create(sourceString, JSC::SourceOrigin(WTF::URL::fileURLWithFileSystemPath(options.filename)), options.filename, JSC::SourceTaintedOrigin::Untainted, TextPosition(options.lineOffset, options.columnOffset)),
        options.lineOffset.zeroBasedInt(), options.columnOffset.zeroBasedInt());

    WTF::NakedPtr<Exception> exception;
    JSValue result = JSC::evaluate(globalObject, source, globalObject, exception);

    if (UNLIKELY(exception)) {
        if (handleException(globalObject, vm, exception, throwScope)) {
            return {};
        }
        JSC::throwException(globalObject, throwScope, exception.get());
        return {};
    }

    return JSValue::encode(result);
}

JSC_DEFINE_HOST_FUNCTION(vmModuleCompileFunction, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // Step 1: Argument validation
    // Get code argument (required)
    JSValue codeArg = callFrame->argument(0);
    if (!codeArg || !codeArg.isString())
        return ERR::INVALID_ARG_TYPE(scope, globalObject, "code"_s, "string"_s, codeArg);

    // Get params argument (optional array of strings)
    MarkedArgumentBuffer parameters;
    JSValue paramsArg = callFrame->argument(1);
    if (paramsArg && !paramsArg.isUndefined()) {
        if (!paramsArg.isObject() || !isArray(globalObject, paramsArg))
            return ERR::INVALID_ARG_INSTANCE(scope, globalObject, "params"_s, "Array"_s, paramsArg);

        auto* paramsArray = jsCast<JSArray*>(paramsArg);
        unsigned length = paramsArray->length();
        for (unsigned i = 0; i < length; i++) {
            JSValue param = paramsArray->getIndexQuickly(i);
            if (!param.isString())
                return ERR::INVALID_ARG_TYPE(scope, globalObject, "params"_s, "Array<string>"_s, paramsArg);
            parameters.append(param);
        }
    }

    // Get options argument
    JSValue optionsArg = callFrame->argument(2);
    CompileFunctionOptions options;
    if (!options.fromJS(globalObject, vm, scope, optionsArg)) {
        RETURN_IF_EXCEPTION(scope, {});
        options = {};
        options.parsingContext = globalObject;
    }

    // Step 3: Create a new function
    // Prepare the function code by combining the parameters and body
    String sourceString = codeArg.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // Create an ArgList with the parameters and function body for constructFunction
    MarkedArgumentBuffer constructFunctionArgs;

    // Add all parameters
    for (unsigned i = 0; i < parameters.size(); i++) {
        constructFunctionArgs.append(parameters.at(i));
    }

    // Add the function body
    constructFunctionArgs.append(jsString(vm, sourceString));

    // Create the source origin
    SourceOrigin sourceOrigin = JSC::SourceOrigin(WTF::URL::fileURLWithFileSystemPath(options.filename));

    // Process contextExtensions if they exist
    JSScope* functionScope = !!options.parsingContext ? options.parsingContext : globalObject;

    if (!options.contextExtensions.isUndefinedOrNull() && !options.contextExtensions.isEmpty() && options.contextExtensions.isObject() && isArray(globalObject, options.contextExtensions)) {
        auto* contextExtensionsArray = jsCast<JSArray*>(options.contextExtensions);
        unsigned length = contextExtensionsArray->length();

        if (length > 0) {
            // Get the global scope from the parsing context
            JSScope* currentScope = options.parsingContext->globalScope();

            // Create JSWithScope objects for each context extension
            for (unsigned i = 0; i < length; i++) {
                JSValue extension = contextExtensionsArray->getIndexQuickly(i);
                if (extension.isObject()) {
                    JSObject* extensionObject = asObject(extension);
                    currentScope = JSWithScope::create(vm, options.parsingContext, currentScope, extensionObject);
                }
            }

            // Use the outermost JSWithScope as our function scope
            functionScope = currentScope;
        }
    }

    options.parsingContext->setGlobalScopeExtension(functionScope);

    // Create the function using constructAnonymousFunction with the appropriate scope chain
    JSFunction* function = constructAnonymousFunction(globalObject, ArgList(constructFunctionArgs), sourceOrigin, options.filename, JSC::SourceTaintedOrigin::Untainted, TextPosition(options.lineOffset, options.columnOffset), functionScope);

    RETURN_IF_EXCEPTION(scope, {});

    if (!function)
        return throwVMError(globalObject, scope, "Failed to compile function"_s);

    return JSValue::encode(function);
}

JSC_DEFINE_HOST_FUNCTION(scriptRunInNewContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    NodeVMScript* script = jsDynamicCast<NodeVMScript*>(callFrame->thisValue());
    JSValue contextObjectValue = callFrame->argument(0);
    // TODO: options
    // JSValue optionsObjectValue = callFrame->argument(1);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!script) {
        throwTypeError(globalObject, scope, "this.runInContext is not a function"_s);
        return {};
    }

    if (!contextObjectValue || contextObjectValue.isUndefinedOrNull()) {
        contextObjectValue = JSC::constructEmptyObject(globalObject);
    }

    if (UNLIKELY(!contextObjectValue || !contextObjectValue.isObject())) {
        throwTypeError(globalObject, scope, "Context must be an object"_s);
        return {};
    }

    // we don't care about options for now
    // TODO: options
    // bool didThrow = false;

    auto* zigGlobal = defaultGlobalObject(globalObject);
    JSObject* context = asObject(contextObjectValue);
    auto* targetContext = NodeVMGlobalObject::create(
        vm, zigGlobal->NodeVMGlobalObjectStructure());

    return runInContext(targetContext, script, context, callFrame->argument(1));
}

Structure* createNodeVMGlobalObjectStructure(JSC::VM& vm)
{
    return NodeVMGlobalObject::createStructure(vm, jsNull());
}

NodeVMGlobalObject* createContextImpl(JSC::VM& vm, JSGlobalObject* globalObject, JSObject* sandbox)
{
    auto* targetContext = NodeVMGlobalObject::create(vm,
        defaultGlobalObject(globalObject)->NodeVMGlobalObjectStructure());

    // Set sandbox as contextified object
    targetContext->setContextifiedObject(sandbox);

    // Store context in WeakMap for isContext checks
    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    zigGlobalObject->vmModuleContextMap()->set(vm, sandbox, targetContext);

    return targetContext;
}

JSC_DEFINE_HOST_FUNCTION(vmModule_createContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue contextArg = callFrame->argument(0);
    if (contextArg.isUndefinedOrNull()) {
        contextArg = JSC::constructEmptyObject(globalObject);
    }

    if (!contextArg.isObject()) {
        return ERR::INVALID_ARG_TYPE(scope, globalObject, "context"_s, "object"_s, contextArg);
    }

    JSValue optionsArg = callFrame->argument(1);

    // Validate options argument
    if (!optionsArg.isUndefined() && !optionsArg.isObject()) {
        return ERR::INVALID_ARG_TYPE(scope, globalObject, "options"_s, "object"_s, optionsArg);
    }

    // If options is provided, validate name and origin properties
    if (optionsArg.isObject()) {
        JSObject* options = asObject(optionsArg);

        // Check name property
        if (JSValue nameValue = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "name"_s))) {
            RETURN_IF_EXCEPTION(scope, {});
            if (!nameValue.isUndefined() && !nameValue.isString()) {
                return ERR::INVALID_ARG_TYPE(scope, globalObject, "options.name"_s, "string"_s, nameValue);
            }
        }

        // Check origin property
        if (JSValue originValue = options->getIfPropertyExists(globalObject, Identifier::fromString(vm, "origin"_s))) {
            RETURN_IF_EXCEPTION(scope, {});
            if (!originValue.isUndefined() && !originValue.isString()) {
                return ERR::INVALID_ARG_TYPE(scope, globalObject, "options.origin"_s, "string"_s, originValue);
            }
        }
    }

    JSObject* sandbox = asObject(contextArg);

    auto* targetContext = NodeVMGlobalObject::create(vm,
        defaultGlobalObject(globalObject)->NodeVMGlobalObjectStructure());

    // Set sandbox as contextified object
    targetContext->setContextifiedObject(sandbox);

    // Store context in WeakMap for isContext checks
    auto* zigGlobalObject = defaultGlobalObject(globalObject);
    zigGlobalObject->vmModuleContextMap()->set(vm, sandbox, targetContext);

    return JSValue::encode(sandbox);
}

JSC_DEFINE_HOST_FUNCTION(vmModule_isContext, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    ArgList args(callFrame);
    JSValue contextArg = callFrame->argument(0);
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    bool isContext;
    if (!contextArg || !contextArg.isObject()) {
        isContext = false;
        return ERR::INVALID_ARG_TYPE(scope, globalObject, "object"_s, "object"_s, contextArg);
    } else {
        auto* zigGlobalObject = defaultGlobalObject(globalObject);
        isContext = zigGlobalObject->vmModuleContextMap()->has(asObject(contextArg));
    }
    return JSValue::encode(jsBoolean(isContext));
}

class NodeVMScriptPrototype final : public JSNonFinalObject {
public:
    using Base = JSNonFinalObject;

    static NodeVMScriptPrototype* create(VM& vm, JSGlobalObject* globalObject, Structure* structure)
    {
        NodeVMScriptPrototype* ptr = new (NotNull, allocateCell<NodeVMScriptPrototype>(vm)) NodeVMScriptPrototype(vm, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, SubspaceAccess>
    static GCClient::IsoSubspace* subspaceFor(VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(NodeVMScriptPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
    {
        return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info());
    }

private:
    NodeVMScriptPrototype(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(NodeVMScriptPrototype, NodeVMScriptPrototype::Base);

static const struct HashTableValue scriptPrototypeTableValues[] = {
    { "cachedDataRejected"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, scriptGetCachedDataRejected, nullptr } },
    { "createCachedData"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, scriptCreateCachedData, 1 } },
    { "runInContext"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, scriptRunInContext, 2 } },
    { "runInNewContext"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, scriptRunInNewContext, 2 } },
    { "runInThisContext"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, scriptRunInThisContext, 2 } },
    { "sourceMapURL"_s, static_cast<unsigned>(PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, scriptGetSourceMapURL, nullptr } },
};

// NodeVMGlobalObject* NodeVMGlobalObject::create(JSC::VM& vm, JSC::Structure* structure)
// {
//     auto* obj = new (NotNull, allocateCell<NodeVMGlobalObject>(vm)) NodeVMGlobalObject(vm, structure);
//     obj->finishCreation(vm);
//     return obj;
// }

// void NodeVMGlobalObject::finishCreation(VM& vm, JSObject* context)
// {
//     Base::finishCreation(vm);
//     // We don't need to store the context anymore since we use proxies
// }

// DEFINE_VISIT_CHILDREN(NodeVMGlobalObject);

// template<typename Visitor>
// void NodeVMGlobalObject::visitChildrenImpl(JSCell* cell, Visitor& visitor)
// {
//     Base::visitChildren(cell, visitor);
//     // auto* thisObject = jsCast<NodeVMGlobalObject*>(cell);
//     // visitor.append(thisObject->m_proxyTarget);
// }

const ClassInfo NodeVMScriptPrototype::s_info = { "Script"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMScriptPrototype) };
const ClassInfo NodeVMScript::s_info = { "Script"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMScript) };
const ClassInfo NodeVMScriptConstructor::s_info = { "Script"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMScriptConstructor) };
const ClassInfo NodeVMGlobalObject::s_info = { "NodeVMGlobalObject"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(NodeVMGlobalObject) };

DEFINE_VISIT_CHILDREN(NodeVMScript);

template<typename Visitor>
void NodeVMScript::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    NodeVMScript* thisObject = jsCast<NodeVMScript*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_cachedDirectExecutable);
}

NodeVMScriptConstructor::NodeVMScriptConstructor(VM& vm, Structure* structure)
    : NodeVMScriptConstructor::Base(vm, structure, scriptConstructorCall, scriptConstructorConstruct)
{
}

NodeVMScriptConstructor* NodeVMScriptConstructor::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSObject* prototype)
{
    NodeVMScriptConstructor* ptr = new (NotNull, allocateCell<NodeVMScriptConstructor>(vm)) NodeVMScriptConstructor(vm, structure);
    ptr->finishCreation(vm, prototype);
    return ptr;
}

void NodeVMScriptConstructor::finishCreation(VM& vm, JSObject* prototype)
{
    Base::finishCreation(vm, 1, "Script"_s, PropertyAdditionMode::WithStructureTransition);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    ASSERT(inherits(info()));
}

void NodeVMScriptPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, NodeVMScript::info(), scriptPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

JSObject* NodeVMScript::createPrototype(VM& vm, JSGlobalObject* globalObject)
{
    return NodeVMScriptPrototype::create(vm, globalObject, NodeVMScriptPrototype::createStructure(vm, globalObject, globalObject->objectPrototype()));
}

NodeVMScript* NodeVMScript::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, SourceCode source)
{
    NodeVMScript* ptr = new (NotNull, allocateCell<NodeVMScript>(vm)) NodeVMScript(vm, structure, source);
    ptr->finishCreation(vm);
    return ptr;
}

void NodeVMScript::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

void NodeVMScript::destroy(JSCell* cell)
{
    static_cast<NodeVMScript*>(cell)->NodeVMScript::~NodeVMScript();
}

JSC::JSValue createNodeVMBinding(Zig::GlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    auto* obj = constructEmptyObject(globalObject);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "Script"_s)),
        defaultGlobalObject(globalObject)->NodeVMScript(), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "createContext"_s)),
        JSC::JSFunction::create(vm, globalObject, 0, "createContext"_s, vmModule_createContext, ImplementationVisibility::Public), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "isContext"_s)),
        JSC::JSFunction::create(vm, globalObject, 0, "isContext"_s, vmModule_isContext, ImplementationVisibility::Public), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "runInNewContext"_s)),
        JSC::JSFunction::create(vm, globalObject, 0, "runInNewContext"_s, vmModuleRunInNewContext, ImplementationVisibility::Public), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "runInThisContext"_s)),
        JSC::JSFunction::create(vm, globalObject, 0, "runInThisContext"_s, vmModuleRunInThisContext, ImplementationVisibility::Public), 0);
    obj->putDirect(
        vm, JSC::PropertyName(JSC::Identifier::fromString(vm, "compileFunction"_s)),
        JSC::JSFunction::create(vm, globalObject, 0, "compileFunction"_s, vmModuleCompileFunction, ImplementationVisibility::Public), 0);
    return obj;
}

void configureNodeVM(JSC::VM& vm, Zig::GlobalObject* globalObject)
{
    globalObject->m_NodeVMScriptClassStructure.initLater(
        [](LazyClassStructure::Initializer& init) {
            auto prototype = NodeVMScript::createPrototype(init.vm, init.global);
            auto* structure = NodeVMScript::createStructure(init.vm, init.global, prototype);
            auto* constructorStructure = NodeVMScriptConstructor::createStructure(
                init.vm, init.global, init.global->m_functionPrototype.get());
            auto* constructor = NodeVMScriptConstructor::create(
                init.vm, init.global, constructorStructure, prototype);
            init.setPrototype(prototype);
            init.setStructure(structure);
            init.setConstructor(constructor);
        });

    globalObject->m_cachedNodeVMGlobalObjectStructure.initLater(
        [](const JSC::LazyProperty<JSC::JSGlobalObject, Structure>::Initializer& init) {
            init.set(createNodeVMGlobalObjectStructure(init.vm));
        });
}

bool NodeVMGlobalObject::deleteProperty(JSCell* cell, JSGlobalObject* globalObject, PropertyName propertyName, JSC::DeletePropertySlot& slot)
{

    auto* thisObject = jsCast<NodeVMGlobalObject*>(cell);
    if (UNLIKELY(!thisObject->m_sandbox)) {
        return Base::deleteProperty(cell, globalObject, propertyName, slot);
    }

    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* sandbox = thisObject->m_sandbox.get();
    if (!sandbox->deleteProperty(sandbox, globalObject, propertyName, slot)) {
        return false;
    }

    RETURN_IF_EXCEPTION(scope, false);
    return Base::deleteProperty(cell, globalObject, propertyName, slot);
}

void NodeVMGlobalObject::getOwnPropertyNames(JSObject* cell, JSGlobalObject* globalObject, JSC::PropertyNameArray& propertyNames, JSC::DontEnumPropertiesMode mode)
{
    auto* thisObject = jsCast<NodeVMGlobalObject*>(cell);

    if (thisObject->m_sandbox) {
        thisObject->m_sandbox->getOwnPropertyNames(
            thisObject->m_sandbox.get(),
            globalObject,
            propertyNames,
            mode);
    }

    Base::getOwnPropertyNames(cell, globalObject, propertyNames, mode);
}

static JSC::JSFunction* constructAnonymousFunction(JSC::JSGlobalObject* globalObject, const ArgList& args, const SourceOrigin& sourceOrigin, const String& fileName, JSC::SourceTaintedOrigin sourceTaintOrigin, TextPosition position, JSC::JSScope* scope)
{
    VM& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    // wrap the arguments in an anonymous function expression
    int startOffset = 0;
    String code = stringifyAnonymousFunction(globalObject, args, throwScope, &startOffset);
    EXCEPTION_ASSERT(!!throwScope.exception() == code.isNull());

    position.m_column = OrdinalNumber::fromZeroBasedInt(position.m_column.zeroBasedInt());
    SourceCode sourceCode(
        JSC::StringSourceProvider::create(code, sourceOrigin, fileName, sourceTaintOrigin, position, SourceProviderSourceType::Program),
        position.m_line.oneBasedInt(), position.m_column.oneBasedInt());

    LexicallyScopedFeatures lexicallyScopedFeatures = globalObject->globalScopeExtension() ? TaintedByWithScopeLexicallyScopedFeature : NoLexicallyScopedFeatures;

    ParserError error;
    bool isEvalNode = false;

    // use default name
    Identifier name;
    std::unique_ptr<ProgramNode> program;

    if (code.is8Bit()) {
        Parser<Lexer<LChar>> parser(vm, sourceCode, ImplementationVisibility::Public, JSParserBuiltinMode::NotBuiltin,
            lexicallyScopedFeatures, JSParserScriptMode::Classic, SourceParseMode::ProgramMode,
            FunctionMode::None, SuperBinding::NotNeeded, ConstructorKind::None, DerivedContextType::None,
            isEvalNode, EvalContextType::None, nullptr);

        program = parser.parse<ProgramNode>(error, name, ParsingContext::Normal);
    } else {
        Parser<Lexer<UChar>> parser(vm, sourceCode, ImplementationVisibility::Public, JSParserBuiltinMode::NotBuiltin,
            lexicallyScopedFeatures, JSParserScriptMode::Classic, SourceParseMode::ProgramMode,
            FunctionMode::None, SuperBinding::NotNeeded, ConstructorKind::None, DerivedContextType::None,
            isEvalNode, EvalContextType::None, nullptr);

        program = parser.parse<ProgramNode>(error, name, ParsingContext::Normal);
    }

    if (!program) {
        RELEASE_ASSERT(error.isValid());
        auto exception = error.toErrorObject(globalObject, sourceCode, -1);
        throwException(globalObject, throwScope, exception);
        return nullptr;
    }

    // the code we passed in should be a single expression statement containing a function expression
    StatementNode* statement = program->singleStatement();
    if (!statement || !statement->isExprStatement()) {
        JSToken token;
        error = ParserError(ParserError::SyntaxError, ParserError::SyntaxErrorIrrecoverable, token, "Parser error"_s, -1);
        auto exception = error.toErrorObject(globalObject, sourceCode, -1);
        throwException(globalObject, throwScope, exception);
        return nullptr;
    }

    ExprStatementNode* exprStatement = static_cast<ExprStatementNode*>(statement);
    ExpressionNode* expression = exprStatement->expr();
    if (!expression || !expression->isFuncExprNode()) {
        throwSyntaxError(globalObject, throwScope, "Expected a function expression"_s);
        return nullptr;
    }

    FunctionMetadataNode* metadata = static_cast<FuncExprNode*>(expression)->metadata();
    ASSERT(metadata);
    if (!metadata)
        return nullptr;

    // metadata->setStartOffset(startOffset);

    ConstructAbility constructAbility = constructAbilityForParseMode(metadata->parseMode());
    UnlinkedFunctionExecutable* unlinkedFunctionExecutable = UnlinkedFunctionExecutable::create(
        vm,
        sourceCode,
        metadata,
        UnlinkedNormalFunction,
        constructAbility,
        InlineAttribute::None,
        JSParserScriptMode::Classic,
        nullptr,
        std::nullopt,
        std::nullopt,
        DerivedContextType::None,
        NeedsClassFieldInitializer::No,
        PrivateBrandRequirement::None);

    unlinkedFunctionExecutable->recordParse(program->features(), metadata->lexicallyScopedFeatures(), /* hasCapturedVariables */ false);

    FunctionExecutable* functionExecutable = unlinkedFunctionExecutable->link(vm, nullptr, sourceCode, std::nullopt);

    JSScope* functionScope = scope ? scope : globalObject->globalScope();

    Structure* structure = JSFunction::selectStructureForNewFuncExp(globalObject, functionExecutable);

    JSFunction* function = JSFunction::create(vm, globalObject, functionExecutable, functionScope, structure);
    return function;
}

// Helper function to create an anonymous function expression with parameters
static String stringifyAnonymousFunction(JSGlobalObject* globalObject, const ArgList& args, ThrowScope& scope, int* outOffset)
{
    // How we stringify functions is important for creating anonymous function expressions
    String program;
    if (args.isEmpty()) {
        // No arguments, just an empty function body
        program = "(function () {\n\n})"_s;
        // program = "(function () {})"_s;
    } else if (args.size() == 1) {
        // Just the function body
        auto body = args.at(0).toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        program = tryMakeString("(function () {"_s, body, "})"_s);
        *outOffset = "(function () {"_s.length();

        if (UNLIKELY(!program)) {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }
    } else {
        // Process parameters and body
        unsigned parameterCount = args.size() - 1;
        StringBuilder paramString;

        for (unsigned i = 0; i < parameterCount; ++i) {
            auto param = args.at(i).toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});

            if (i > 0)
                paramString.append(", "_s);

            paramString.append(param);
        }

        auto body = args.at(parameterCount).toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});

        program = tryMakeString("(function ("_s, paramString.toString(), ") {"_s, body, "})"_s);
        *outOffset = "(function ("_s.length() + paramString.length() + ") {"_s.length();

        if (UNLIKELY(!program)) {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }
    }

    return program;
}

} // namespace Bun
