#include "root.h"

#include "BunWritableStreamDefaultWriter.h"
#include "BunWritableStream.h"
#include "JSDOMWrapper.h"
#include <wtf/NeverDestroyed.h>

namespace Bun {

using namespace JSC;

class JSWritableStreamDefaultWriter;
class JSWritableStreamDefaultWriterPrototype;

class JSWritableStreamDefaultWriterConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;

    static JSWritableStreamDefaultWriterConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSWritableStreamDefaultWriterPrototype* prototype);

    DECLARE_INFO;
    template<typename, JSC::SubspaceAccess mode>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;

        return WebCore::subspaceForImpl<JSWritableStreamDefaultWriterConstructor, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForBunClassConstructor.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForBunClassConstructor = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForBunClassConstructor.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForBunClassConstructor = std::forward<decltype(space)>(space); });
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES construct(JSC::JSGlobalObject*, JSC::CallFrame*);
    static JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES call(JSC::JSGlobalObject*, JSC::CallFrame*);

private:
    JSWritableStreamDefaultWriterConstructor(JSC::VM&, JSC::Structure*);
    void finishCreation(JSC::VM&, JSC::JSGlobalObject*, JSWritableStreamDefaultWriterPrototype*);
};

class JSWritableStreamDefaultWriterPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static JSWritableStreamDefaultWriterPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSWritableStreamDefaultWriterPrototype* ptr = new (NotNull, JSC::allocateCell<JSWritableStreamDefaultWriterPrototype>(vm)) JSWritableStreamDefaultWriterPrototype(vm, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSWritableStreamDefaultWriterPrototype, Base);
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSWritableStreamDefaultWriterPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
};

static JSC_DECLARE_CUSTOM_GETTER(jsWritableStreamDefaultWriterClosedGetter);
static JSC_DECLARE_CUSTOM_GETTER(jsWritableStreamDefaultWriterReadyGetter);
static JSC_DECLARE_CUSTOM_GETTER(jsWritableStreamDefaultWriterDesiredSizeGetter);
static JSC_DECLARE_HOST_FUNCTION(jsWritableStreamDefaultWriterWrite);
static JSC_DECLARE_HOST_FUNCTION(jsWritableStreamDefaultWriterAbort);
static JSC_DECLARE_HOST_FUNCTION(jsWritableStreamDefaultWriterClose);
static JSC_DECLARE_HOST_FUNCTION(jsWritableStreamDefaultWriterReleaseLock);

// Property attributes for standard WritableStreamDefaultWriter prototype properties
static const unsigned ProtoAccessorDontDelete = PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly | PropertyAttribute::CustomAccessor;
static const unsigned ProtoFunctionDontEnum = PropertyAttribute::DontEnum | PropertyAttribute::Function;

// Table of prototype properties and methods
static const HashTableValue JSWritableStreamDefaultWriterPrototypeTableValues[] = {
    { "closed"_s, ProtoAccessorDontDelete, NoIntrinsic,
        { HashTableValue::GetterSetterType, jsWritableStreamDefaultWriterClosedGetter, nullptr } },
    { "ready"_s, ProtoAccessorDontDelete, NoIntrinsic,
        { HashTableValue::GetterSetterType, jsWritableStreamDefaultWriterReadyGetter, nullptr } },
    { "desiredSize"_s, ProtoAccessorDontDelete, NoIntrinsic,
        { HashTableValue::GetterSetterType, jsWritableStreamDefaultWriterDesiredSizeGetter, nullptr } },
    { "write"_s, ProtoFunctionDontEnum, NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsWritableStreamDefaultWriterWrite, 1 } },
    { "abort"_s, ProtoFunctionDontEnum, NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsWritableStreamDefaultWriterAbort, 1 } },
    { "close"_s, ProtoFunctionDontEnum, NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsWritableStreamDefaultWriterClose, 0 } },
    { "releaseLock"_s, ProtoFunctionDontEnum, NoIntrinsic,
        { HashTableValue::NativeFunctionType, jsWritableStreamDefaultWriterReleaseLock, 0 } },
};

const ClassInfo JSWritableStreamDefaultWriterPrototype::s_info = {
    "WritableStreamDefaultWriter"_s,
    &Base::s_info,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(JSWritableStreamDefaultWriterPrototype)
};

void JSWritableStreamDefaultWriterPrototype::finishCreation(VM& vm, JSGlobalObject* globalObject)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, info(), JSWritableStreamDefaultWriterPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// Getter implementations
JSC_DEFINE_CUSTOM_GETTER(jsWritableStreamDefaultWriterClosedGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* writer = jsDynamicCast<JSWritableStreamDefaultWriter*>(JSValue::decode(thisValue));
    if (!writer) {
        throwTypeError(globalObject, scope, "Not a WritableStreamDefaultWriter"_s);
        return encodedJSValue();
    }

    return JSValue::encode(writer->closed());
}

JSC_DEFINE_CUSTOM_GETTER(jsWritableStreamDefaultWriterReadyGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* writer = jsDynamicCast<JSWritableStreamDefaultWriter*>(JSValue::decode(thisValue));
    if (!writer) {
        throwTypeError(globalObject, scope, "Not a WritableStreamDefaultWriter"_s);
        return encodedJSValue();
    }

    return JSValue::encode(writer->ready());
}

JSC_DEFINE_CUSTOM_GETTER(jsWritableStreamDefaultWriterDesiredSizeGetter, (JSGlobalObject * globalObject, EncodedJSValue thisValue, PropertyName))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* writer = jsDynamicCast<JSWritableStreamDefaultWriter*>(JSValue::decode(thisValue));
    if (!writer) {
        throwTypeError(globalObject, scope, "Not a WritableStreamDefaultWriter"_s);
        return encodedJSValue();
    }

    return JSValue::encode(jsNumber(writer->desiredSize()));
}

// Additional JS method implementation
JSC_DEFINE_HOST_FUNCTION(jsWritableStreamDefaultWriterReleaseLock, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSWritableStreamDefaultWriter* writer = jsDynamicCast<JSWritableStreamDefaultWriter*>(callFrame->thisValue());
    if (!writer) {
        scope.throwException(globalObject, createTypeError(globalObject, "Not a WritableStreamDefaultWriter"_s));
        return {};
    }

    writer->release();
    return JSValue::encode(jsUndefined());
}

const ClassInfo JSWritableStreamDefaultWriterConstructor::s_info = {
    "Function"_s,
    &Base::s_info,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(JSWritableStreamDefaultWriterConstructor)
};

JSWritableStreamDefaultWriterConstructor::JSWritableStreamDefaultWriterConstructor(VM& vm, Structure* structure)
    : Base(vm, structure, call, construct)
{
}

void JSWritableStreamDefaultWriterConstructor::finishCreation(VM& vm, JSGlobalObject* globalObject, JSWritableStreamDefaultWriterPrototype* prototype)
{
    Base::finishCreation(vm, 1, "WritableStreamDefaultWriter"_s, PropertyAttribute::DontEnum | PropertyAttribute::ReadOnly);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete | PropertyAttribute::ReadOnly);
    ASSERT(inherits(info()));
}

JSWritableStreamDefaultWriterConstructor* JSWritableStreamDefaultWriterConstructor::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSWritableStreamDefaultWriterPrototype* prototype)
{
    JSWritableStreamDefaultWriterConstructor* constructor = new (NotNull, allocateCell<JSWritableStreamDefaultWriterConstructor>(vm)) JSWritableStreamDefaultWriterConstructor(vm, structure);
    constructor->finishCreation(vm, globalObject, prototype);
    return constructor;
}

// This is called when constructing a new writer with new WritableStreamDefaultWriter(stream)
EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSWritableStreamDefaultWriterConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    VM& vm = lexicalGlobalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!callFrame->argumentCount()) {
        throwTypeError(lexicalGlobalObject, scope, "WritableStreamDefaultWriter constructor requires a WritableStream argument"_s);
        return encodedJSValue();
    }

    JSValue streamValue = callFrame->argument(0);
    JSWritableStream* stream = jsDynamicCast<JSWritableStream*>(streamValue);
    if (!stream) {
        throwTypeError(lexicalGlobalObject, scope, "WritableStreamDefaultWriter constructor argument must be a WritableStream"_s);
        return encodedJSValue();
    }

    // Check if stream is locked
    if (stream->locked()) {
        throwTypeError(lexicalGlobalObject, scope, "Cannot construct a WritableStreamDefaultWriter for a locked WritableStream"_s);
        return encodedJSValue();
    }

    Structure* structure = globalObject->WritableStreamDefaultWriterStructure();
    JSWritableStreamDefaultWriter* writer = JSWritableStreamDefaultWriter::create(vm, structure, stream);
    return JSValue::encode(writer);
}

// This handles direct calls to WritableStreamDefaultWriter as a function, which should throw an error
EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSWritableStreamDefaultWriterConstructor::call(JSGlobalObject* globalObject, CallFrame*)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    return throwVMTypeError(globalObject, scope, "WritableStreamDefaultWriter constructor cannot be called as a function"_s);
}

const ClassInfo JSWritableStreamDefaultWriter::s_info = {
    "WritableStreamDefaultWriter"_s,
    &Base::s_info,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(JSWritableStreamDefaultWriter)
};

JSWritableStreamDefaultWriter::JSWritableStreamDefaultWriter(VM& vm, Structure* structure, JSWritableStream* stream)
    : Base(vm, structure)
    , m_stream(vm, this, stream)
    , m_closedPromise(vm, this, JSPromise::create(vm, globalObject->promiseStructure()))
    , m_readyPromise(vm, this, JSPromise::create(vm, globalObject->promiseStructure()))
{
}

JSWritableStreamDefaultWriter* JSWritableStreamDefaultWriter::create(VM& vm, Structure* structure, JSWritableStream* stream)
{
    JSWritableStreamDefaultWriter* writer = new (
        NotNull,
        allocateCell<JSWritableStreamDefaultWriter>(vm)) JSWritableStreamDefaultWriter(vm, structure, stream);

    writer->finishCreation(vm);
    return writer;
}

void JSWritableStreamDefaultWriter::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

void JSWritableStreamDefaultWriter::destroy(JSCell* cell)
{
    static_cast<JSWritableStreamDefaultWriter*>(cell)->JSWritableStreamDefaultWriter::~JSWritableStreamDefaultWriter();
}

template<typename Visitor>
void JSWritableStreamDefaultWriter::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* writer = jsCast<JSWritableStreamDefaultWriter*>(cell);
    ASSERT_GC_OBJECT_INHERITS(writer, info());

    Base::visitChildren(writer, visitor);
    writer->visitAdditionalChildren(visitor);
}

DEFINE_VISIT_CHILDREN(JSWritableStreamDefaultWriter);

template<typename Visitor>
void JSWritableStreamDefaultWriter::visitAdditionalChildren(Visitor& visitor)
{
    visitor.append(m_stream);
    visitor.append(m_closedPromise);
    visitor.append(m_readyPromise);
}

DEFINE_VISIT_ADDITIONAL_CHILDREN(JSWritableStreamDefaultWriter);

// JS Interface Methods

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamDefaultWriterWrite, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSWritableStreamDefaultWriter* writer = jsDynamicCast<JSWritableStreamDefaultWriter*>(callFrame->thisValue());
    if (!writer) {
        scope.throwException(globalObject,
            createTypeError(globalObject, "Not a WritableStreamDefaultWriter"_s));
        return {};
    }

    JSValue chunk = callFrame->argument(0);

    JSValue error;
    if (!writer->write(globalObject, chunk, &error)) {
        scope.throwException(globalObject, error);
        return {};
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamDefaultWriterClose, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSWritableStreamDefaultWriter* writer = jsDynamicCast<JSWritableStreamDefaultWriter*>(callFrame->thisValue());
    if (!writer) {
        scope.throwException(globalObject,
            createTypeError(globalObject, "Not a WritableStreamDefaultWriter"_s));
        return {};
    }

    JSValue error;
    if (!writer->close(globalObject, &error)) {
        scope.throwException(globalObject, error);
        return {};
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamDefaultWriterAbort, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSWritableStreamDefaultWriter* writer = jsDynamicCast<JSWritableStreamDefaultWriter*>(callFrame->thisValue());
    if (!writer) {
        scope.throwException(globalObject,
            createTypeError(globalObject, "Not a WritableStreamDefaultWriter"_s));
        return {};
    }

    JSValue reason = callFrame->argument(0);

    JSValue error;
    if (!writer->abort(globalObject, reason, &error)) {
        scope.throwException(globalObject, error);
        return {};
    }

    return JSValue::encode(jsUndefined());
}

// Non-JS Methods for C++ Use

bool JSWritableStreamDefaultWriter::write(JSGlobalObject* globalObject, JSValue chunk, JSValue* error)
{
    VM& vm = globalObject->vm();

    if (!m_stream) {
        if (error)
            *error = createTypeError(globalObject, "Writer has no associated stream"_s);
        return false;
    }

    return m_stream->write(globalObject, chunk, error);
}

bool JSWritableStreamDefaultWriter::close(JSGlobalObject* globalObject, JSValue* error)
{
    VM& vm = globalObject->vm();

    if (!m_stream) {
        if (error)
            *error = createTypeError(globalObject, "Writer has no associated stream"_s);
        return false;
    }

    return m_stream->close(globalObject, error);
}

bool JSWritableStreamDefaultWriter::abort(JSGlobalObject* globalObject, JSValue reason, JSValue* error)
{
    VM& vm = globalObject->vm();

    if (!m_stream) {
        if (error)
            *error = createTypeError(globalObject, "Writer has no associated stream"_s);
        return false;
    }

    return m_stream->abort(globalObject, reason, error);
}

void JSWritableStreamDefaultWriter::release()
{
    m_stream.clear();
    m_closedPromise->reject(vm(), jsUndefined());
    m_readyPromise->reject(vm(), jsUndefined());
}

void JSWritableStreamDefaultWriter::resolveClosedPromise(JSGlobalObject* globalObject, JSValue value)
{
    if (m_closedPromise)
        m_closedPromise->resolve(globalObject, value);
}

void JSWritableStreamDefaultWriter::rejectClosedPromise(JSGlobalObject* globalObject, JSValue error)
{
    if (m_closedPromise)
        m_closedPromise->reject(globalObject, error);
}

} // namespace Bun
