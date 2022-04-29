#include "root.h"
#include "JSBuffer.h"

#include "ActiveDOMObject.h"
#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"
#include "IDLTypes.h"
// #include "JSBlob.h"
#include "JSDOMAttribute.h"
#include "JSDOMBinding.h"
#include "JSDOMConstructor.h"
#include "JSDOMConvertBase.h"
#include "JSDOMConvertInterface.h"
#include "JSDOMConvertStrings.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObject.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMOperation.h"
#include "JSDOMWrapperCache.h"
#include "ScriptExecutionContext.h"
#include "WebCoreJSClientData.h"
#include "JavaScriptCore/FunctionPrototype.h"
#include "JavaScriptCore/HeapAnalyzer.h"

#include "JavaScriptCore/JSDestructibleObjectHeapCellType.h"
#include "JavaScriptCore/SlotVisitorMacros.h"
#include "JavaScriptCore/SubspaceInlines.h"
#include "wtf/GetPtr.h"
#include "wtf/PointerPreparations.h"
#include "wtf/URL.h"

#include "JSBufferEncodingType.h"
#include "JSBufferPrototypeBuiltins.h"
#include "JavaScriptCore/JSBase.h"
#if ENABLE(MEDIA_SOURCE)
#include "BufferMediaSource.h"
#include "JSMediaSource.h"
#endif

// #include "JavaScriptCore/JSTypedArrayViewPrototype.h"
#include "JavaScriptCore/JSArrayBufferViewInlines.h"

static JSC_DECLARE_HOST_FUNCTION(jsBufferConstructorFunction_alloc);
static JSC_DECLARE_HOST_FUNCTION(jsBufferConstructorFunction_allocUnsafe);
static JSC_DECLARE_HOST_FUNCTION(jsBufferConstructorFunction_allocUnsafeSlow);
static JSC_DECLARE_HOST_FUNCTION(jsBufferConstructorFunction_byteLength);
static JSC_DECLARE_HOST_FUNCTION(jsBufferConstructorFunction_compare);
static JSC_DECLARE_HOST_FUNCTION(jsBufferConstructorFunction_concat);
static JSC_DECLARE_HOST_FUNCTION(jsBufferConstructorFunction_from);
static JSC_DECLARE_HOST_FUNCTION(jsBufferConstructorFunction_isBuffer);
static JSC_DECLARE_HOST_FUNCTION(jsBufferConstructorFunction_isEncoding);
static JSC_DECLARE_HOST_FUNCTION(jsBufferConstructorFunction_toBuffer);

static JSC_DECLARE_HOST_FUNCTION(jsBufferPrototypeFunction_compare);
static JSC_DECLARE_HOST_FUNCTION(jsBufferPrototypeFunction_copy);
static JSC_DECLARE_HOST_FUNCTION(jsBufferPrototypeFunction_equals);
static JSC_DECLARE_HOST_FUNCTION(jsBufferPrototypeFunction_fill);
static JSC_DECLARE_HOST_FUNCTION(jsBufferPrototypeFunction_includes);
static JSC_DECLARE_HOST_FUNCTION(jsBufferPrototypeFunction_indexOf);
static JSC_DECLARE_HOST_FUNCTION(jsBufferPrototypeFunction_lastIndexOf);
static JSC_DECLARE_HOST_FUNCTION(jsBufferPrototypeFunction_swap16);
static JSC_DECLARE_HOST_FUNCTION(jsBufferPrototypeFunction_swap32);
static JSC_DECLARE_HOST_FUNCTION(jsBufferPrototypeFunction_swap64);
static JSC_DECLARE_HOST_FUNCTION(jsBufferPrototypeFunction_toString);
static JSC_DECLARE_HOST_FUNCTION(jsBufferPrototypeFunction_write);

static void toBuffer(JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSUint8Array* uint8Array);

JSC::EncodedJSValue JSBuffer__bufferFromPointerAndLengthAndDeinit(JSC::JSGlobalObject* lexicalGlobalObject, char* ptr, unsigned int length, void* ctx, JSTypedArrayBytesDeallocator bytesDeallocator)
{

    JSC::JSUint8Array* uint8Array = nullptr;

    if (LIKELY(length > 0)) {
        auto buffer = ArrayBuffer::createFromBytes(ptr, length, createSharedTask<void(void*)>([=](void* p) {
            if (bytesDeallocator)
                bytesDeallocator(p, ctx);
        }));

        uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, lexicalGlobalObject->typedArrayStructure(JSC::TypeUint8), WTFMove(buffer), 0, length);
    } else {
        uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, lexicalGlobalObject->typedArrayStructure(JSC::TypeUint8), 0);
    }

    toBuffer(lexicalGlobalObject, uint8Array);

    return JSC::JSValue::encode(uint8Array);
}

namespace WebCore {
using namespace JSC;

EncodedJSValue JSBuffer__bufferFromLength(JSC::JSGlobalObject* lexicalGlobalObject, int length)
{
    auto throwScope = DECLARE_THROW_SCOPE(lexicalGlobalObject->vm());

    if (UNLIKELY(length < 0)) {
        throwRangeError(lexicalGlobalObject, throwScope, "Invalid array length");
        return JSValue::encode(jsUndefined());
    }

    JSC::JSUint8Array* uint8Array = nullptr;

    if (LIKELY(length > 0)) {

        auto arrayBuffer = JSC::ArrayBuffer::tryCreateUninitialized(length, 1);
        if (UNLIKELY(!arrayBuffer)) {
            throwOutOfMemoryError(lexicalGlobalObject, throwScope);
            return JSValue::encode(jsUndefined());
        }

        uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, lexicalGlobalObject->typedArrayStructure(JSC::TypeUint8), WTFMove(arrayBuffer), 0, length);
    } else {
        uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, lexicalGlobalObject->typedArrayStructure(JSC::TypeUint8), 0);
    }

    toBuffer(lexicalGlobalObject, uint8Array);

    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(uint8Array));
}

EncodedJSValue JSBuffer__bufferFromPointerAndLength(JSC::JSGlobalObject* lexicalGlobalObject, char* ptr, unsigned int length)
{

    JSC::JSUint8Array* uint8Array;

    if (LIKELY(length > 0)) {
        auto buffer = ArrayBuffer::createFromBytes(ptr, length, nullptr);

        uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, lexicalGlobalObject->typedArrayStructure(JSC::TypeUint8), WTFMove(buffer), 0, length);
    } else {
        uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, lexicalGlobalObject->typedArrayStructure(JSC::TypeUint8), 0);
    }

    toBuffer(lexicalGlobalObject, uint8Array);

    return JSC::JSValue::encode(uint8Array);
}

template<> class IDLOperation<JSBuffer> {
public:
    using ClassParameter = JSC::JSUint8Array*;
    using Operation = JSC::EncodedJSValue(JSC::JSGlobalObject*, JSC::CallFrame*, ClassParameter);

    template<Operation operation, CastedThisErrorBehavior = CastedThisErrorBehavior::Throw>
    static JSC::EncodedJSValue call(JSC::JSGlobalObject& lexicalGlobalObject, JSC::CallFrame& callFrame, const char* operationName)
    {
        auto& vm = JSC::getVM(&lexicalGlobalObject);
        auto throwScope = DECLARE_THROW_SCOPE(vm);

        auto thisValue = callFrame.thisValue().toThis(&lexicalGlobalObject, JSC::ECMAMode::strict());
        if (thisValue.isUndefinedOrNull()) {
            throwTypeError(&lexicalGlobalObject, throwScope, "Cannot convert undefined or null to object");
            return JSC::JSValue::encode(JSC::jsUndefined());
        }

        auto thisObject = JSC::jsCast<JSC::JSUint8Array*>(thisValue);
        if (UNLIKELY(!thisObject))
            return throwThisTypeError(lexicalGlobalObject, throwScope, "Buffer", operationName);

        RELEASE_AND_RETURN(throwScope, (operation(&lexicalGlobalObject, &callFrame, thisObject)));
    }
};

class JSBufferPrototype : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr JSC::TypedArrayType TypedArrayStorageType = JSC::JSUint8Array::Adaptor::typeValue;
    static JSBufferPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSBufferPrototype* ptr = new (NotNull, JSC::allocateCell<JSBufferPrototype>(vm)) JSBufferPrototype(vm, globalObject, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSBufferPrototype(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSBufferPrototype, JSBufferPrototype::Base);

bool JSBuffer__isBuffer(JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue value)
{
    VM& vm = lexicalGlobalObject->vm();
    auto clientData = WebCore::clientData(vm);

    auto* jsBuffer = JSC::jsDynamicCast<JSUint8Array*>(vm, JSC::JSValue::decode(value));
    if (!jsBuffer)
        return false;

    return !!jsBuffer->getIfPropertyExists(lexicalGlobalObject, clientData->builtinNames().dataViewPrivateName());
}

static inline JSC::EncodedJSValue jsBufferConstructorFunction_allocBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBuffer>::ClassParameter castedThis)
{
    VM& vm = lexicalGlobalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto length = callFrame->uncheckedArgument(0).toInt32(lexicalGlobalObject);
    if (length < 0) {
        throwRangeError(lexicalGlobalObject, throwScope, "Invalid array length");
        return JSValue::encode(jsUndefined());
    }

    auto arrayBuffer = JSC::ArrayBuffer::tryCreate(length, 1);
    if (!arrayBuffer) {
        throwOutOfMemoryError(lexicalGlobalObject, throwScope);
        return JSValue::encode(jsUndefined());
    }

    auto uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, lexicalGlobalObject->typedArrayStructure(JSC::TypeUint8), WTFMove(arrayBuffer), 0, length);
    toBuffer(lexicalGlobalObject, uint8Array);

    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(uint8Array));
}
JSC_DEFINE_HOST_FUNCTION(jsBufferConstructorFunction_alloc, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSBuffer>::call<jsBufferConstructorFunction_allocBody>(*lexicalGlobalObject, *callFrame, "alloc");
}
static inline JSC::EncodedJSValue jsBufferConstructorFunction_allocUnsafeBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBuffer>::ClassParameter castedThis)
{

    VM& vm = lexicalGlobalObject->vm();

    auto throwScope = DECLARE_THROW_SCOPE(vm);

    if (callFrame->argumentCount() < 1)
        return throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));

    auto length = callFrame->uncheckedArgument(0).toInt32(lexicalGlobalObject);
    RELEASE_AND_RETURN(throwScope, JSBuffer__bufferFromLength(lexicalGlobalObject, length));
}
JSC_DEFINE_HOST_FUNCTION(jsBufferConstructorFunction_allocUnsafe, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSBuffer>::call<jsBufferConstructorFunction_allocUnsafeBody>(*lexicalGlobalObject, *callFrame, "allocUnsafe");
}
static inline JSC::EncodedJSValue jsBufferConstructorFunction_allocUnsafeSlowBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBuffer>::ClassParameter castedThis)
{
    return jsBufferConstructorFunction_allocUnsafeBody(lexicalGlobalObject, callFrame, castedThis);
}
JSC_DEFINE_HOST_FUNCTION(jsBufferConstructorFunction_allocUnsafeSlow, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSBuffer>::call<jsBufferConstructorFunction_allocUnsafeSlowBody>(*lexicalGlobalObject, *callFrame, "allocUnsafeSlow");
}
static inline JSC::EncodedJSValue jsBufferConstructorFunction_byteLengthBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBuffer>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    return JSValue::encode(jsUndefined());
}
JSC_DEFINE_HOST_FUNCTION(jsBufferConstructorFunction_byteLength, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSBuffer>::call<jsBufferConstructorFunction_byteLengthBody>(*lexicalGlobalObject, *callFrame, "byteLength");
}
static inline JSC::EncodedJSValue jsBufferConstructorFunction_compareBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBuffer>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    return JSValue::encode(jsUndefined());
}
JSC_DEFINE_HOST_FUNCTION(jsBufferConstructorFunction_compare, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSBuffer>::call<jsBufferConstructorFunction_compareBody>(*lexicalGlobalObject, *callFrame, "compare");
}
static inline JSC::EncodedJSValue jsBufferConstructorFunction_concatBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBuffer>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    return JSValue::encode(jsUndefined());
}
JSC_DEFINE_HOST_FUNCTION(jsBufferConstructorFunction_concat, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSBuffer>::call<jsBufferConstructorFunction_concatBody>(*lexicalGlobalObject, *callFrame, "concat");
}
static inline JSC::EncodedJSValue jsBufferConstructorFunction_fromBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBuffer>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    return JSValue::encode(jsUndefined());
}
JSC_DEFINE_HOST_FUNCTION(jsBufferConstructorFunction_from, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
}
static inline JSC::EncodedJSValue jsBufferConstructorFunction_isBufferBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBuffer>::ClassParameter castedThis)
{
    if (callFrame->argumentCount() < 1)
        return JSC::JSValue::encode(JSC::jsBoolean(false));

    return JSC::JSValue::encode(JSC::jsBoolean(JSBuffer__isBuffer(lexicalGlobalObject, JSC::JSValue::encode(callFrame->uncheckedArgument(0)))));
}
JSC_DEFINE_HOST_FUNCTION(jsBufferConstructorFunction_isBuffer, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSBuffer>::call<jsBufferConstructorFunction_isBufferBody>(*lexicalGlobalObject, *callFrame, "isBuffer");
}
static inline JSC::EncodedJSValue jsBufferConstructorFunction_isEncodingBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBuffer>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    return JSValue::encode(jsUndefined());
}
JSC_DEFINE_HOST_FUNCTION(jsBufferConstructorFunction_isEncoding, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSBuffer>::call<jsBufferConstructorFunction_isEncodingBody>(*lexicalGlobalObject, *callFrame, "isEncoding");
}

static inline JSC::EncodedJSValue jsBufferConstructorFunction_toBufferBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBuffer>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (UNLIKELY(callFrame->argumentCount() < 1)) {
        throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
        return JSValue::encode(jsUndefined());
    }

    auto buffer = callFrame->uncheckedArgument(0);
    if (!buffer.isCell() || !JSC::isTypedView(buffer.asCell()->classInfo(vm)->typedArrayStorageType)) {
        throwVMTypeError(lexicalGlobalObject, throwScope, "Expected Uint8Array"_s);
    }

    JSC::JSUint8Array* view = JSC::jsDynamicCast<JSC::JSUint8Array*>(vm, buffer);

    if (!view) {
        throwVMTypeError(lexicalGlobalObject, throwScope, "Expected Uint8Array"_s);
        return JSValue::encode(jsUndefined());
    }
    toBuffer(lexicalGlobalObject, view);
    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(view));
}
JSC_DEFINE_HOST_FUNCTION(jsBufferConstructorFunction_toBuffer, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSBuffer>::call<jsBufferConstructorFunction_toBufferBody>(*lexicalGlobalObject, *callFrame, "toBuffer");
}

using JSBufferConstructor = JSDOMConstructor<JSBuffer>;

/* Hash table for constructor */
static const HashTableValue JSBufferConstructorTableValues[] = {
    { "alloc", static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferConstructorFunction_alloc), (intptr_t)(3) } },
    { "allocUnsafe", static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferConstructorFunction_allocUnsafe), (intptr_t)(1) } },
    { "allocUnsafeSlow", static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferConstructorFunction_allocUnsafe), (intptr_t)(1) } },
    { "byteLength", static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferConstructorFunction_byteLength), (intptr_t)(2) } },
    { "compare", static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferConstructorFunction_compare), (intptr_t)(2) } },
    { "concat", static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferConstructorFunction_concat), (intptr_t)(2) } },
    { "from", static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferConstructorFunction_from), (intptr_t)(3) } },
    { "isBuffer", static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferConstructorFunction_isBuffer), (intptr_t)(1) } },
    { "toBuffer", static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferConstructorFunction_toBuffer), (intptr_t)(1) } },
    { "isEncoding", static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferConstructorFunction_isEncoding), (intptr_t)(1) } },
};

// new Buffer()
static inline EncodedJSValue constructBufferEmpty(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    return JSBuffer__bufferFromLength(lexicalGlobalObject, 0);
}

// new Buffer(size)
static inline EncodedJSValue constructBufferFromLength(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    return jsBufferConstructorFunction_allocUnsafeBody(lexicalGlobalObject, callFrame, nullptr);
}

static inline JSC::EncodedJSValue constructBufferFromStringAndEncoding(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBuffer>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    uint32_t offset = 0;
    uint32_t length = castedThis->length();
    WebCore::BufferEncodingType encoding = WebCore::BufferEncodingType::utf8;

    auto scope = DECLARE_THROW_SCOPE(vm);

    EnsureStillAliveScope arg0 = callFrame->argument(0);
    auto* str = arg0.value().toString(lexicalGlobalObject);

    EnsureStillAliveScope arg1 = callFrame->argument(1);

    if (str->length() == 0)
        return constructBufferEmpty(lexicalGlobalObject, callFrame);

    if (callFrame->argumentCount() > 1) {
        std::optional<BufferEncodingType> encoded = parseEnumeration<BufferEncodingType>(*lexicalGlobalObject, callFrame->argument(1));
        if (!encoded) {
            throwTypeError(lexicalGlobalObject, scope, "Invalid encoding");
            return JSC::JSValue::encode(jsUndefined());
        }

        encoding = encoded.value();
    }

    auto view = str->tryGetValue(lexicalGlobalObject);
    JSC::EncodedJSValue result;

    switch (encoding) {
    case WebCore::BufferEncodingType::utf8: {
        if (view.is8Bit()) {
            result = Bun__encoding__constructFromLatin1AsUTF8(lexicalGlobalObject, view.characters8(), view.length());
        } else {
            result = Bun__encoding__constructFromUTF16AsUTF8(lexicalGlobalObject, view.characters16(), view.length());
        }
        break;
    }

    case WebCore::BufferEncodingType::latin1:
    case WebCore::BufferEncodingType::ascii: {
        if (view.is8Bit()) {
            result = Bun__encoding__constructFromLatin1AsASCII(lexicalGlobalObject, view.characters8(), view.length());
        } else {
            result = Bun__encoding__constructFromUTF16AsASCII(lexicalGlobalObject, view.characters16(), view.length());
        }
        break;
    }
    case WebCore::BufferEncodingType::ucs2:
    case WebCore::BufferEncodingType::utf16le: {
        if (view.is8Bit()) {
            result = Bun__encoding__constructFromLatin1AsUTF16(lexicalGlobalObject, view.characters8(), view.length());
        } else {
            result = Bun__encoding__constructFromUTF16AsUTF16(lexicalGlobalObject, view.characters16(), view.length());
        }
        break;
    }

    case WebCore::BufferEncodingType::base64: {
        if (view.is8Bit()) {
            result = Bun__encoding__constructFromLatin1AsBase64(lexicalGlobalObject, view.characters8(), view.length());
        } else {
            result = Bun__encoding__constructFromUTF16AsBase64(lexicalGlobalObject, view.characters16(), view.length());
        }
        break;
    }

    case WebCore::BufferEncodingType::base64url: {
        if (view.is8Bit()) {
            result = Bun__encoding__constructFromLatin1AsURLSafeBase64(lexicalGlobalObject, view.characters8(), view.length());
        } else {
            result = Bun__encoding__constructFromUTF16AsURLSafeBase64(lexicalGlobalObject, view.characters16(), view.length());
        }
        break;
    }

    case WebCore::BufferEncodingType::hex: {
        if (view.is8Bit()) {
            result = Bun__encoding__constructFromLatin1AsHex(lexicalGlobalObject, view.characters8(), view.length());
        } else {
            result = Bun__encoding__constructFromUTF16AsHex(lexicalGlobalObject, view.characters16(), view.length());
        }
        break;
    }
    }
    JSC::JSValue decoded = JSC::JSValue::decode(result);
    if (UNLIKELY(!result)) {
        throwTypeError(lexicalGlobalObject, scope, "An error occurred while decoding the string"_s);
        return JSC::JSValue::encode(jsUndefined());
    }

    if (decoded.isCell() && decoded.getObject()->isErrorInstance()) {
        scope.throwException(lexicalGlobalObject, decoded);
        return JSC::JSValue::encode(jsUndefined());
    }

    RELEASE_AND_RETURN(scope, result);
}

template<> EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSBufferConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    VM& vm = lexicalGlobalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    UNUSED_PARAM(throwScope);
    size_t argsCount = std::min<size_t>(3, callFrame->argumentCount());
    if (argsCount == 0) {
        RELEASE_AND_RETURN(throwScope, (constructBufferEmpty(lexicalGlobalObject, callFrame)));
    }
    JSValue distinguishingArg = callFrame->uncheckedArgument(0);
    if (distinguishingArg.isNumber()) {
        RELEASE_AND_RETURN(throwScope, (constructBufferFromLength(lexicalGlobalObject, callFrame)));
    } else if (distinguishingArg.isString()) {
        RELEASE_AND_RETURN(throwScope, (constructBufferFromStringAndEncoding(lexicalGlobalObject, callFrame, nullptr)));
    }

    JSC::JSObject* constructor = lexicalGlobalObject->m_typedArrayUint8.constructor(lexicalGlobalObject);

    // TODO: avoid this copy
    MarkedArgumentBuffer args;
    for (size_t i = 0; i < argsCount; ++i)
        args.append(callFrame->uncheckedArgument(i));

    JSC::JSObject* object = JSC::construct(lexicalGlobalObject, constructor, callFrame->newTarget(), args, "Failed to construct 'Buffer' object"_s);
    if (!object) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    auto value = JSC::JSValue(object);

    toBuffer(lexicalGlobalObject, JSC::jsCast<JSC::JSUint8Array*>(value));

    RELEASE_AND_RETURN(throwScope, JSC::JSValue::encode(value));
}
JSC_ANNOTATE_HOST_FUNCTION(JSBufferConstructorConstruct, JSBufferConstructor::construct);

template<> const ClassInfo JSBufferConstructor::s_info = { "Buffer"_s, nullptr, nullptr, nullptr, CREATE_METHOD_TABLE(JSBufferConstructor) };

template<> JSValue JSBufferConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    UNUSED_PARAM(vm);
    return globalObject.functionPrototype();
}

template<> void JSBufferConstructor::initializeProperties(VM& vm, JSDOMGlobalObject& globalObject)
{
    putDirect(vm, vm.propertyNames->length, jsNumber(1), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "Buffer"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    putDirect(vm, vm.propertyNames->prototype, JSBuffer::prototype(vm, globalObject), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
    reifyStaticProperties(vm, JSBuffer::info(), JSBufferConstructorTableValues, *this);
}

const ClassInfo JSBuffer::s_info = { "Buffer"_s, JSC::getUint8ArrayClassInfo(), nullptr, nullptr, CREATE_METHOD_TABLE(JSBuffer) };

static inline JSC::EncodedJSValue jsBufferPrototypeFunction_compareBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBuffer>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    return JSC::JSValue::encode(jsUndefined());
}
static inline JSC::EncodedJSValue jsBufferPrototypeFunction_copyBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBuffer>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    return JSC::JSValue::encode(jsUndefined());
}
static inline JSC::EncodedJSValue jsBufferPrototypeFunction_equalsBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBuffer>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    return JSC::JSValue::encode(jsUndefined());
}
static inline JSC::EncodedJSValue jsBufferPrototypeFunction_fillBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBuffer>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    return JSC::JSValue::encode(jsUndefined());
}
static inline JSC::EncodedJSValue jsBufferPrototypeFunction_includesBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBuffer>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    UNUSED_PARAM(throwScope);
    UNUSED_PARAM(callFrame);

    return JSC::JSValue::encode(JSC::JSValue(reinterpret_cast<uint8_t*>(castedThis->vector())[0]));
}
static inline JSC::EncodedJSValue jsBufferPrototypeFunction_indexOfBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBuffer>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    return JSC::JSValue::encode(jsUndefined());
}
static inline JSC::EncodedJSValue jsBufferPrototypeFunction_lastIndexOfBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBuffer>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    return JSC::JSValue::encode(jsUndefined());
}
static inline JSC::EncodedJSValue jsBufferPrototypeFunction_swap16Body(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBuffer>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    return JSC::JSValue::encode(jsUndefined());
}
static inline JSC::EncodedJSValue jsBufferPrototypeFunction_swap32Body(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBuffer>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    return JSC::JSValue::encode(jsUndefined());
}
static inline JSC::EncodedJSValue jsBufferPrototypeFunction_swap64Body(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBuffer>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    return JSC::JSValue::encode(jsUndefined());
}
static inline JSC::EncodedJSValue jsBufferPrototypeFunction_toStringBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBuffer>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    uint32_t offset = 0;
    uint32_t length = castedThis->length();
    WebCore::BufferEncodingType encoding = WebCore::BufferEncodingType::utf8;

    if (length == 0)
        return JSC::JSValue::encode(JSC::jsEmptyString(vm));

    auto scope = DECLARE_THROW_SCOPE(vm);

    switch (callFrame->argumentCount()) {
    case 0: {
        break;
    }
    case 2:
    case 3:
    case 1: {
        JSC::JSValue arg1 = callFrame->uncheckedArgument(0);
        std::optional<BufferEncodingType> encoded = parseEnumeration<BufferEncodingType>(*lexicalGlobalObject, arg1);
        if (!encoded) {
            throwTypeError(lexicalGlobalObject, scope, "Invalid encoding");
            return JSC::JSValue::encode(jsUndefined());
        }

        encoding = encoded.value();
        if (callFrame->argumentCount() == 1)
            break;
    }
    // any
    case 5: {
        JSC::JSValue arg2 = callFrame->uncheckedArgument(1);
        int32_t ioffset = arg2.toInt32(lexicalGlobalObject);
        if (ioffset < 0) {
            throwTypeError(lexicalGlobalObject, scope, "Offset must be a positive integer");
            return JSC::JSValue::encode(jsUndefined());
        }
        offset = static_cast<uint32_t>(ioffset);

        if (callFrame->argumentCount() == 2)
            break;
    }

    default: {
        length = static_cast<uint32_t>(callFrame->argument(2).toInt32(lexicalGlobalObject));
        break;
    }
    }

    length -= std::min(offset, length);

    if (UNLIKELY(length == 0)) {
        RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::jsEmptyString(vm)));
    }

    JSC::EncodedJSValue ret = 0;

    switch (encoding) {
    case WebCore::BufferEncodingType::buffer:
    case WebCore::BufferEncodingType::utf8: {
        ret = Bun__encoding__toStringUTF8(castedThis->typedVector() + offset, length, lexicalGlobalObject);
        break;
    }

    case WebCore::BufferEncodingType::latin1:
    case WebCore::BufferEncodingType::ascii: {
        ret = Bun__encoding__toStringASCII(castedThis->typedVector() + offset, length, lexicalGlobalObject);
        break;
    }

    case WebCore::BufferEncodingType::ucs2:
    case WebCore::BufferEncodingType::utf16le: {
        ret = Bun__encoding__toStringUTF16(castedThis->typedVector() + offset, length, lexicalGlobalObject);
        break;
    }

    case WebCore::BufferEncodingType::base64: {
        ret = Bun__encoding__toStringBase64(castedThis->typedVector() + offset, length, lexicalGlobalObject);
        break;
    }

    case WebCore::BufferEncodingType::base64url: {
        ret = Bun__encoding__toStringURLSafeBase64(castedThis->typedVector() + offset, length, lexicalGlobalObject);
        break;
    }

    case WebCore::BufferEncodingType::hex: {
        ret = Bun__encoding__toStringHex(castedThis->typedVector() + offset, length, lexicalGlobalObject);
        break;
    }
    default: {
        throwTypeError(lexicalGlobalObject, scope, "Unsupported encoding? This shouldn't happen");
        break;
    }
    }

    JSC::JSValue retValue = JSC::JSValue::decode(ret);
    if (UNLIKELY(!retValue.isString())) {
        scope.throwException(lexicalGlobalObject, retValue);
        return JSC::JSValue::encode(jsUndefined());
    }

    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(retValue));
}
static inline JSC::EncodedJSValue jsBufferPrototypeFunction_writeBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSBuffer>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    uint32_t offset = 0;
    uint32_t length = castedThis->length();
    WebCore::BufferEncodingType encoding = WebCore::BufferEncodingType::utf8;

    auto scope = DECLARE_THROW_SCOPE(vm);

    if (UNLIKELY(callFrame->argumentCount() == 0)) {
        throwTypeError(lexicalGlobalObject, scope, "Not enough arguments");
        return JSC::JSValue::encode(jsUndefined());
    }

    EnsureStillAliveScope arg0 = callFrame->argument(0);
    auto* str = arg0.value().toStringOrNull(lexicalGlobalObject);
    if (!str) {
        throwTypeError(lexicalGlobalObject, scope, "write() expects a string");
        return JSC::JSValue::encode(jsUndefined());
    }

    EnsureStillAliveScope arg1 = callFrame->argument(1);

    if (str->length() == 0)
        return JSC::JSValue::encode(JSC::jsNumber(0));

    if (callFrame->argumentCount() > 1) {
        if (arg1.value().isAnyInt()) {
            int32_t ioffset = arg1.value().toInt32(lexicalGlobalObject);
            if (ioffset < 0) {
                throwTypeError(lexicalGlobalObject, scope, "Offset must be a positive integer");
                return JSC::JSValue::encode(jsUndefined());
            }
            offset = static_cast<uint32_t>(ioffset);
        } else if (arg1.value().isString()) {
            std::optional<BufferEncodingType> encoded = parseEnumeration<BufferEncodingType>(*lexicalGlobalObject, arg1.value());
            if (!encoded) {
                throwTypeError(lexicalGlobalObject, scope, "Invalid encoding");
                return JSC::JSValue::encode(jsUndefined());
            }

            encoding = encoded.value();
        }
    }

    if (callFrame->argumentCount() > 2) {
        length = static_cast<uint32_t>(callFrame->argument(2).toInt32(lexicalGlobalObject));
    }

    length -= std::min(offset, length);

    if (UNLIKELY(length < offset)) {
        RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::jsNumber(0)));
    }

    if (callFrame->argumentCount() > 2) {
        std::optional<BufferEncodingType> encoded = parseEnumeration<BufferEncodingType>(*lexicalGlobalObject, callFrame->argument(3));
        if (!encoded) {
            throwTypeError(lexicalGlobalObject, scope, "Invalid encoding");
            return JSC::JSValue::encode(jsUndefined());
        }

        encoding = encoded.value();
    }

    auto view = str->tryGetValue(lexicalGlobalObject);
    int64_t written = 0;

    switch (encoding) {
    case WebCore::BufferEncodingType::utf8: {
        if (view.is8Bit()) {
            written = Bun__encoding__writeLatin1AsUTF8(view.characters8(), view.length(), castedThis->typedVector() + offset, length);
        } else {
            written = Bun__encoding__writeUTF16AsUTF8(view.characters16(), view.length(), castedThis->typedVector() + offset, length);
        }
        break;
    }

    case WebCore::BufferEncodingType::latin1:
    case WebCore::BufferEncodingType::ascii: {
        if (view.is8Bit()) {
            written = Bun__encoding__writeLatin1AsASCII(view.characters8(), view.length(), castedThis->typedVector() + offset, length);
        } else {
            written = Bun__encoding__writeUTF16AsASCII(view.characters16(), view.length(), castedThis->typedVector() + offset, length);
        }
        break;
    }
    case WebCore::BufferEncodingType::ucs2:
    case WebCore::BufferEncodingType::utf16le: {
        if (view.is8Bit()) {
            written = Bun__encoding__writeLatin1AsUTF16(view.characters8(), view.length(), castedThis->typedVector() + offset, length);
        } else {
            written = Bun__encoding__writeUTF16AsUTF16(view.characters16(), view.length(), castedThis->typedVector() + offset, length);
        }
        break;
    }

    case WebCore::BufferEncodingType::base64: {
        if (view.is8Bit()) {
            written = Bun__encoding__writeLatin1AsBase64(view.characters8(), view.length(), castedThis->typedVector() + offset, length);
        } else {
            written = Bun__encoding__writeUTF16AsBase64(view.characters16(), view.length(), castedThis->typedVector() + offset, length);
        }
        break;
    }

    case WebCore::BufferEncodingType::base64url: {
        if (view.is8Bit()) {
            written = Bun__encoding__writeLatin1AsURLSafeBase64(view.characters8(), view.length(), castedThis->typedVector() + offset, length);
        } else {
            written = Bun__encoding__writeUTF16AsURLSafeBase64(view.characters16(), view.length(), castedThis->typedVector() + offset, length);
        }
        break;
    }

    case WebCore::BufferEncodingType::hex: {
        if (view.is8Bit()) {
            written = Bun__encoding__writeLatin1AsHex(view.characters8(), view.length(), castedThis->typedVector() + offset, length);
        } else {
            written = Bun__encoding__writeUTF16AsHex(view.characters16(), view.length(), castedThis->typedVector() + offset, length);
        }
        break;
    }
    }

    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::jsNumber(written)));
}

JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_compare, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSBuffer>::call<jsBufferPrototypeFunction_compareBody>(*lexicalGlobalObject, *callFrame, "compare");
}
JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_copy, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSBuffer>::call<jsBufferPrototypeFunction_copyBody>(*lexicalGlobalObject, *callFrame, "copy");
}
JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_equals, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSBuffer>::call<jsBufferPrototypeFunction_equalsBody>(*lexicalGlobalObject, *callFrame, "equals");
}
JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_fill, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSBuffer>::call<jsBufferPrototypeFunction_fillBody>(*lexicalGlobalObject, *callFrame, "fill");
}
JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_includes, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSBuffer>::call<jsBufferPrototypeFunction_includesBody>(*lexicalGlobalObject, *callFrame, "includes");
}
JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_indexOf, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSBuffer>::call<jsBufferPrototypeFunction_indexOfBody>(*lexicalGlobalObject, *callFrame, "indexOf");
}
JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_lastIndexOf, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSBuffer>::call<jsBufferPrototypeFunction_lastIndexOfBody>(*lexicalGlobalObject, *callFrame, "lastIndexOf");
}
JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_swap16, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSBuffer>::call<jsBufferPrototypeFunction_swap16Body>(*lexicalGlobalObject, *callFrame, "swap16");
}
JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_swap32, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSBuffer>::call<jsBufferPrototypeFunction_swap32Body>(*lexicalGlobalObject, *callFrame, "swap32");
}
JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_swap64, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSBuffer>::call<jsBufferPrototypeFunction_swap64Body>(*lexicalGlobalObject, *callFrame, "swap64");
}
JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_toString, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSBuffer>::call<jsBufferPrototypeFunction_toStringBody>(*lexicalGlobalObject, *callFrame, "toString");
}
JSC_DEFINE_HOST_FUNCTION(jsBufferPrototypeFunction_write, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSBuffer>::call<jsBufferPrototypeFunction_writeBody>(*lexicalGlobalObject, *callFrame, "write");
}

/* */

/* Hash table for prototype */

static const HashTableValue JSBufferPrototypeTableValues[]
    = {
          { "asciiSlice", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeAsciiSliceCodeGenerator), (intptr_t)(2) } },
          { "asciiWrite", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeAsciiWriteCodeGenerator), (intptr_t)(1) } },
          { "base64Slice", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeBase64SliceCodeGenerator), (intptr_t)(2) } },
          { "base64urlSlice", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeBase64urlSliceCodeGenerator), (intptr_t)(2) } },
          { "base64urlWrite", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeBase64urlWriteCodeGenerator), (intptr_t)(1) } },
          { "base64Write", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeBase64WriteCodeGenerator), (intptr_t)(1) } },
          { "compare", static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferPrototypeFunction_compare), (intptr_t)(5) } },
          { "copy", static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferPrototypeFunction_copy), (intptr_t)(4) } },
          { "equals", static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferPrototypeFunction_equals), (intptr_t)(1) } },
          { "fill", static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferPrototypeFunction_fill), (intptr_t)(4) } },
          { "hexSlice", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeHexSliceCodeGenerator), (intptr_t)(2) } },
          { "hexWrite", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeHexWriteCodeGenerator), (intptr_t)(1) } },
          { "includes", static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferPrototypeFunction_includes), (intptr_t)(3) } },
          { "indexOf", static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferPrototypeFunction_indexOf), (intptr_t)(3) } },
          { "lastIndexOf", static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferPrototypeFunction_lastIndexOf), (intptr_t)(3) } },
          { "latin1Slice", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeLatin1SliceCodeGenerator), (intptr_t)(2) } },
          { "latin1Write", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeLatin1WriteCodeGenerator), (intptr_t)(1) } },
          { "readBigInt64", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeReadBigInt64LECodeGenerator), (intptr_t)(1) } },
          { "readBigInt64BE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeReadBigInt64BECodeGenerator), (intptr_t)(1) } },
          { "readBigInt64LE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeReadBigInt64LECodeGenerator), (intptr_t)(1) } },
          { "readBigUInt64", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeReadBigUInt64LECodeGenerator), (intptr_t)(1) } },
          { "readBigUInt64BE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeReadBigUInt64BECodeGenerator), (intptr_t)(1) } },
          { "readBigUInt64LE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeReadBigUInt64LECodeGenerator), (intptr_t)(1) } },
          { "readDouble", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeReadDoubleLECodeGenerator), (intptr_t)(1) } },
          { "readDoubleBE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeReadDoubleBECodeGenerator), (intptr_t)(1) } },
          { "readDoubleLE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeReadDoubleLECodeGenerator), (intptr_t)(1) } },
          { "readFloat", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeReadFloatLECodeGenerator), (intptr_t)(1) } },
          { "readFloatBE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeReadFloatBECodeGenerator), (intptr_t)(1) } },
          { "readFloatLE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeReadFloatLECodeGenerator), (intptr_t)(1) } },
          { "readInt16", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeReadInt16LECodeGenerator), (intptr_t)(1) } },
          { "readInt16BE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeReadInt16BECodeGenerator), (intptr_t)(1) } },
          { "readInt16LE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeReadInt16LECodeGenerator), (intptr_t)(1) } },
          { "readInt32", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeReadInt32LECodeGenerator), (intptr_t)(1) } },
          { "readInt32BE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeReadInt32BECodeGenerator), (intptr_t)(1) } },
          { "readInt32LE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeReadInt32LECodeGenerator), (intptr_t)(1) } },
          { "readInt8", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeReadInt8CodeGenerator), (intptr_t)(2) } },
          { "readUint16BE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeReadUInt16BECodeGenerator), (intptr_t)(1) } },
          { "readUInt16BE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeReadUInt16BECodeGenerator), (intptr_t)(1) } },
          { "readUint16LE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeReadUInt16LECodeGenerator), (intptr_t)(1) } },
          { "readUInt16LE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeReadUInt16LECodeGenerator), (intptr_t)(1) } },
          { "readUint32BE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeReadUInt32BECodeGenerator), (intptr_t)(1) } },
          { "readUInt32BE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeReadUInt32BECodeGenerator), (intptr_t)(1) } },
          { "readUint32LE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeReadUInt32LECodeGenerator), (intptr_t)(1) } },
          { "readUInt32LE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeReadUInt32LECodeGenerator), (intptr_t)(1) } },
          { "readUint8", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeReadUInt8CodeGenerator), (intptr_t)(1) } },
          { "readUInt8", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeReadUInt8CodeGenerator), (intptr_t)(1) } },
          { "slice", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeSliceCodeGenerator), (intptr_t)(2) } },
          { "subarray", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeSliceCodeGenerator), (intptr_t)(2) } },
          { "swap16", static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferPrototypeFunction_swap16), (intptr_t)(0) } },
          { "swap32", static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferPrototypeFunction_swap32), (intptr_t)(0) } },
          { "swap64", static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferPrototypeFunction_swap64), (intptr_t)(0) } },
          { "toString", static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferPrototypeFunction_toString), (intptr_t)(4) } },
          { "ucs2Slice", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeUcs2SliceCodeGenerator), (intptr_t)(2) } },
          { "ucs2Write", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeUcs2WriteCodeGenerator), (intptr_t)(1) } },
          { "utf16leSlice", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeUtf16leSliceCodeGenerator), (intptr_t)(2) } },
          { "utf16leWrite", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeUtf16leWriteCodeGenerator), (intptr_t)(1) } },
          { "utf8Slice", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeUtf8SliceCodeGenerator), (intptr_t)(2) } },
          { "utf8Write", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeUtf8WriteCodeGenerator), (intptr_t)(1) } },
          { "write", static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { (intptr_t) static_cast<RawNativeFunction>(jsBufferPrototypeFunction_write), (intptr_t)(4) } },
          { "writeBigInt64BE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteBigInt64BECodeGenerator), (intptr_t)(1) } },
          { "writeBigInt64LE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteBigInt64LECodeGenerator), (intptr_t)(1) } },
          { "writeBigUint64BE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteBigUInt64BECodeGenerator), (intptr_t)(1) } },
          { "writeBigUInt64BE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteBigUInt64BECodeGenerator), (intptr_t)(1) } },
          { "writeBigUint64LE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteBigUInt64LECodeGenerator), (intptr_t)(1) } },
          { "writeBigUInt64LE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteBigUInt64LECodeGenerator), (intptr_t)(1) } },
          { "writeDouble", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteDoubleLECodeGenerator), (intptr_t)(1) } },
          { "writeDoubleBE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteDoubleBECodeGenerator), (intptr_t)(1) } },
          { "writeDoubleLE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteDoubleLECodeGenerator), (intptr_t)(1) } },
          { "writeFloat", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteFloatLECodeGenerator), (intptr_t)(1) } },
          { "writeFloatBE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteFloatBECodeGenerator), (intptr_t)(1) } },
          { "writeFloatLE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteFloatLECodeGenerator), (intptr_t)(1) } },
          { "writeInt16BE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteInt16BECodeGenerator), (intptr_t)(1) } },
          { "writeInt16LE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteInt16LECodeGenerator), (intptr_t)(1) } },
          { "writeInt32BE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteInt32BECodeGenerator), (intptr_t)(1) } },
          { "writeInt32LE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteInt32LECodeGenerator), (intptr_t)(1) } },
          { "writeInt8", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteInt8CodeGenerator), (intptr_t)(1) } },
          { "writeUint16", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteUInt16LECodeGenerator), (intptr_t)(1) } },
          { "writeUInt16", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteUInt16LECodeGenerator), (intptr_t)(1) } },
          { "writeUint16BE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteUInt16BECodeGenerator), (intptr_t)(1) } },
          { "writeUInt16BE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteUInt16BECodeGenerator), (intptr_t)(1) } },
          { "writeUint16LE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteUInt16LECodeGenerator), (intptr_t)(1) } },
          { "writeUInt16LE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteUInt16LECodeGenerator), (intptr_t)(1) } },
          { "writeUint32", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteUInt32LECodeGenerator), (intptr_t)(1) } },
          { "writeUInt32", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteUInt32LECodeGenerator), (intptr_t)(1) } },
          { "writeUint32BE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteUInt32BECodeGenerator), (intptr_t)(1) } },
          { "writeUInt32BE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteUInt32BECodeGenerator), (intptr_t)(1) } },
          { "writeUint32LE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteUInt32LECodeGenerator), (intptr_t)(1) } },
          { "writeUInt32LE", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteUInt32LECodeGenerator), (intptr_t)(1) } },
          { "writeUint8", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteUInt8CodeGenerator), (intptr_t)(1) } },
          { "writeUInt8", static_cast<unsigned>(JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::Builtin), NoIntrinsic, { (intptr_t) static_cast<BuiltinGenerator>(jsBufferPrototypeWriteUInt8CodeGenerator), (intptr_t)(1) } },
      };

void JSBufferPrototype::finishCreation(VM& vm, JSC::JSGlobalObject* globalThis)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSBuffer::info(), JSBufferPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
    this->setPrototypeDirect(vm, globalThis->m_typedArrayUint8.prototype(globalThis));
}

const ClassInfo JSBufferPrototype::s_info = { "Buffer"_s, nullptr, nullptr, nullptr, CREATE_METHOD_TABLE(JSBufferPrototype) };

JSObject* JSBuffer::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return JSBufferPrototype::create(vm, &globalObject, JSBufferPrototype::createStructure(vm, &globalObject, globalObject.m_typedArrayUint8.prototype(&globalObject)));
}

JSObject* JSBuffer::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSBuffer>(vm, globalObject);
}

JSValue JSBuffer::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSBufferConstructor, DOMConstructorID::Buffer>(vm, *jsCast<const JSDOMGlobalObject*>(globalObject));
}

void JSBuffer::destroy(JSC::JSCell* cell)
{
    JSBuffer* thisObject = static_cast<JSBuffer*>(cell);
    thisObject->JSBuffer::~JSBuffer();
}

JSBuffer::JSBuffer(Structure* structure, JSDOMGlobalObject& globalObject, Ref<Buffer>&& impl)
    : JSDOMWrapper<Buffer>(structure, globalObject, WTFMove(impl))
{
}

void JSBuffer::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(vm, info()));

    // static_assert(!std::is_base_of<ActiveDOMObject, DOMURL>::value, "Interface is not marked as [ActiveDOMObject] even though implementation class subclasses ActiveDOMObject.");
}

JSC::GCClient::IsoSubspace* JSBuffer::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSBuffer, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForBuffer.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForBuffer = WTFMove(space); },
        [](auto& spaces) { return spaces.m_subspaceForBuffer.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForBuffer = WTFMove(space); });
}

// template<typename Visitor>
// void JSBuffer::visitChildrenImpl(JSCell* cell, Visitor& visitor)
// {
//     auto* thisObject = jsCast<Buffer*>(cell);
//     ASSERT_GC_OBJECT_INHERITS(thisObject, info());
//     Base::visitChildren(thisObject, visitor);
// }

// DEFINE_VISIT_CHILDREN(JSBuffer);

// template<typename Visitor>
// void JSBuffer::visitOutputConstraints(JSCell* cell, Visitor& visitor)
// {
//     auto* thisObject = jsCast<Buffer*>(cell);
//     ASSERT_GC_OBJECT_INHERITS(thisObject, info());
//     Base::visitOutputConstraints(thisObject, visitor);
// }

// template void JSBuffer::visitOutputConstraints(JSCell*, AbstractSlotVisitor&);
// template void JSBuffer::visitOutputConstraints(JSCell*, SlotVisitor&);
// void JSBuffer::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
// {
//     auto* thisObject = jsCast<Buffer*>(cell);
//     analyzer.setWrappedObjectForCell(cell, &thisObject->wrapped());
//     // if (thisObject->scriptExecutionContext())
//     // analyzer.setLabelForCell(cell, "url " + thisObject->scriptExecutionContext()->url().string());
//     Base::analyzeHeap(cell, analyzer);
// }

JSBufferOwner::~JSBufferOwner()
{
}

bool JSBufferOwner::isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown> handle, void*, AbstractSlotVisitor& visitor, const char** reason)
{
    UNUSED_PARAM(handle);
    UNUSED_PARAM(visitor);
    UNUSED_PARAM(reason);
    return false;
}

void JSBufferOwner::finalize(JSC::Handle<JSC::Unknown> handle, void* context)
{
    auto* jsBuffer = static_cast<JSBuffer*>(handle.slot()->asCell());
    auto& world = *static_cast<DOMWrapperWorld*>(context);
    uncacheWrapper(world, &jsBuffer->wrapped(), jsBuffer);
}

JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject*, JSDOMGlobalObject* globalObject, Ref<Buffer>&& impl)
{

    return createWrapper<Buffer>(globalObject, WTFMove(impl));
}

JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, Buffer& impl)
{
    return wrap(lexicalGlobalObject, globalObject, impl);
}

Buffer* JSBuffer::toWrapped(JSC::VM& vm, JSC::JSValue value)
{
    if (auto* wrapper = jsDynamicCast<JSBuffer*>(vm, value))
        return &wrapper->wrapped();
    return nullptr;
}

} // namespace WebCore

static void toBuffer(JSC::JSGlobalObject* lexicalGlobalObject, JSC::JSUint8Array* uint8Array)
{
    JSC::VM& vm = lexicalGlobalObject->vm();
    auto clientData = WebCore::clientData(vm);
    JSC::JSObject* object = JSC::JSValue(uint8Array).getObject();

    object->setPrototypeDirect(vm, WebCore::JSBuffer::prototype(vm, *JSC::jsCast<WebCore::JSDOMGlobalObject*>(lexicalGlobalObject)));

    auto* dataView = JSC::JSDataView::create(lexicalGlobalObject, lexicalGlobalObject->typedArrayStructure(JSC::TypeDataView), uint8Array->possiblySharedBuffer(), uint8Array->byteOffset(), uint8Array->length());
    object->putDirectWithoutTransition(vm, clientData->builtinNames().dataViewPublicName(), dataView, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
    // Mark it
    object->putDirectWithoutTransition(vm, clientData->builtinNames().dataViewPrivateName(), JSC::JSValue(true), JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
}