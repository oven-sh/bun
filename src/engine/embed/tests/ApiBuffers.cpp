#include "ApiFixtures.h"

using namespace JSC;
using Test::Realm;

static constexpr uint8_t someBytes[] = { 1, 2, 3, 4, 5, 6, 7, 8 };

static void count(void*, void* counter) { ++*static_cast<unsigned*>(counter); }

TEST(TypedArrayTypes)
{
    static_assert(typedArrayType(Uint8ArrayType) == TypeUint8 && typedArrayType(DataViewType) == TypeDataView);
    static_assert(typedArrayType(ArrayBufferType) == NotTypedArray && typedArrayType(GlobalObjectType) == NotTypedArray);
    static_assert(elementSize(TypeDataView) == 1 && elementSize(NotTypedArray) == 1);

    Realm realm;
#define CHECK_TYPE(name)                                                                                                 \
    {                                                                                                                    \
        auto* array = JS##name##Array::create(realm.global, realm.global->typedArrayStructure(Type##name, false), 3);    \
        realm.define("array"_s, array);                                                                                  \
        EXPECT(realm.run("Object.getPrototypeOf(array) === " #name "Array.prototype && array.length === 3"_s).isTrue()); \
        EXPECT(array->classInfo() == JS##name##Array::info() && array->inherits(JSArrayBufferView::info()));             \
        EXPECT(static_cast<JSArrayBufferView*>(array)->byteLength() == 3 * elementSize(Type##name));                     \
        EXPECT(array->byteLength() == 3 * elementSize(Type##name));                                                      \
    }
    FOR_EACH_TYPED_ARRAY_TYPE_EXCLUDING_DATA_VIEW(CHECK_TYPE)
#undef CHECK_TYPE
}

TEST(ArrayBufferCreation)
{
    Realm realm;
    auto zeros = ArrayBuffer::create(4, 2);
    EXPECT(zeros->byteLength() == 8 && std::ranges::all_of(zeros->span(), [](uint8_t byte) { return !byte; }));
    EXPECT(!zeros->isDetached() && !zeros->isShared() && !zeros->isResizableOrGrowableShared() && !zeros->maxByteLength());
    EXPECT(!zeros->wrapper() && !zeros->isWasmMemory() && zeros->isDetachable());
    EXPECT(equalSpans(ArrayBuffer::create(someBytes)->span(), std::span(someBytes)));
    EXPECT(!ArrayBuffer::create()->isDetached());

    EXPECT(!ArrayBuffer::tryCreate(MAX_ARRAY_BUFFER_SIZE + 1, 1));
    EXPECT(!ArrayBuffer::tryCreate(size_t { 1 } << 62, 4));
    EXPECT(!ArrayBuffer::tryCreateUninitialized(size_t { 1 } << 61, 8));
    EXPECT(!ArrayBuffer::tryCreate(9, 1, 8));

    auto resizable = ArrayBuffer::tryCreate(4, 1, 1 << 20);
    EXPECT(resizable->isResizableNonShared() && resizable->byteLength() == 4 && resizable->maxByteLength() == 1u << 20);

    auto* adopted = static_cast<uint8_t*>(fastMalloc(8));
    EXPECT(ArrayBuffer::createAdopted({ adopted, 8 })->data() == adopted);
}

TEST(ArrayBufferOfExternalBytes)
{
    unsigned freed = 0;
    {
        auto buffer = ArrayBuffer::createFromBytes(someBytes, count, &freed);
        Ref other = buffer;
        EXPECT(buffer->data() == someBytes);
    }
    EXPECT(freed == 1);

    void* address = nullptr;
    ArrayBuffer::createFromBytes(someBytes, createSharedTask<void(void*)>([&](void* data) { address = data; }));
    EXPECT(address == someBytes);
    ArrayBuffer::createFromBytes(someBytes, nullptr);

    EXPECT(ArrayBuffer::createFromBytes({}, count, &freed)->isDetached());
    EXPECT(freed == 2);
}

TEST(ArrayBufferContentsMove)
{
    Realm realm;
    unsigned freed = 0;
    {
        Vector<ArrayBufferContents> list(1);
        EXPECT(!list[0] && !list[0].sizeInBytes());
        EXPECT(ArrayBuffer::createFromBytes(someBytes, count, &freed)->transferTo(realm.vm, list[0]));
        list.grow(100);
        EXPECT(list[0].data() == someBytes && list[0].sizeInBytes() == 8);
        list[1] = WTF::move(list[0]);
        EXPECT(!list[0] && !freed);
        EXPECT(!list[1].shareWith(list[2]));
        auto buffer = ArrayBuffer::create(WTF::move(list[1]));
        EXPECT(!list[1] && buffer->data() == someBytes && !freed);
    }
    EXPECT(freed == 1);
}

TEST(ArrayBufferSharing)
{
    Realm realm;
    auto* object = downcast<JSArrayBuffer>(realm.run("globalThis.shared = new SharedArrayBuffer(4, { maxByteLength: 64 })"_s));
    EXPECT(object->isShared() && object->isResizableOrGrowableShared() && !object->impl()->isDetachable());
    ArrayBufferContents contents;
    EXPECT(object->impl()->shareWith(contents));
    realm.run("shared.grow(16)"_s);
    EXPECT(contents.sizeInBytes() == 16 && object->impl()->byteLength() == 16 && contents.data() == object->impl()->data());

    unsigned freed = 0;
    {
        auto buffer = ArrayBuffer::createFromBytes(someBytes, count, &freed);
        buffer->makeShared();
        EXPECT(buffer->sharingMode() == ArrayBufferSharingMode::Shared && buffer->transferTo(realm.vm, contents));
        EXPECT(!buffer->isDetached());
    }
    EXPECT(!freed && contents.data() == someBytes);
    contents = {};
    EXPECT(freed == 1);
}

TEST(ArrayBufferWrapper)
{
    Realm realm;
    auto buffer = ArrayBuffer::create(someBytes);
    auto* object = JSArrayBuffer::wrap(realm.global, buffer);
    EXPECT(object->impl() == buffer.ptr() && buffer->wrapper() == object && JSArrayBuffer::wrap(realm.global, buffer) == object);
    realm.define("buffer"_s, object);
    EXPECT(realm.run("buffer instanceof ArrayBuffer && new Uint8Array(buffer).buffer === buffer"_s).isTrue());

    auto check = [&](ASCIILiteral script, bool isPlain, bool isFixed, bool isUnshared) {
        JSValue value = realm.run(script);
        EXPECT(toPossiblySharedArrayBuffer(realm.vm, value));
        EXPECT(!!JSArrayBuffer::toWrapped(realm.vm, value) == isPlain);
        EXPECT(!!JSArrayBuffer::toWrappedAllowShared(realm.vm, value) == isFixed);
        EXPECT(!!toUnsharedArrayBuffer(realm.vm, value) == isUnshared);
    };
    check("new ArrayBuffer(1)"_s, true, true, true);
    check("new ArrayBuffer(1, { maxByteLength: 2 })"_s, false, false, true);
    check("new SharedArrayBuffer(1)"_s, false, true, false);
    check("new SharedArrayBuffer(1, { maxByteLength: 2 })"_s, false, false, false);
    EXPECT(!toPossiblySharedArrayBuffer(realm.vm, realm.run("new Uint8Array(1)"_s)));
}

TEST(ArrayBufferDetachAndPin)
{
    Realm realm;
    auto* view = downcast<JSUint16Array>(realm.run("globalThis.view = new Uint16Array(new ArrayBuffer(16), 4, 2)"_s));
    EXPECT(view->length() == 2 && view->byteOffset() == 4 && view->hasArrayBuffer());
    auto* buffer = view->existingBuffer();
    EXPECT(view->vector() == static_cast<uint8_t*>(buffer->data()) + 4);

    buffer->pin();
    ArrayBufferContents copy;
    EXPECT(!buffer->isDetachable() && buffer->transferTo(realm.vm, copy));
    EXPECT(!view->isDetached() && copy.data() != buffer->data() && copy.sizeInBytes() == 16);
    buffer->unpin();

    buffer->detach(realm.vm);
    EXPECT(view->isDetached() && view->isOutOfBounds() && !view->length() && !view->byteOffset() && view->span().empty());
    EXPECT(!buffer->transferTo(realm.vm, copy));
    EXPECT(realm.run("view.buffer.detached"_s).isTrue());
}

TEST(ViewWithoutBuffer)
{
    Realm realm;
    auto* structure = realm.global->typedArrayStructureWithTypedArrayType<TypeUint8>();

    auto* empty = JSUint8Array::create(realm.global, structure, 0);
    EXPECT(!empty->isDetached() && !empty->length());

    auto* small = JSUint8Array::createUninitialized(realm.global, structure, JSArrayBufferView::fastSizeLimit);
    memset(small->vector(), 7, small->byteLength());
    EXPECT(small->hasVectorInHeap() && !small->existingBuffer());
    EXPECT(small->tryPin() && small->hasArrayBuffer() && !small->existingBuffer()->isDetachable());
    EXPECT(small->typedSpan().back() == 7);
    small->unpin();
    EXPECT(small->existingBuffer()->isDetachable());

    auto* large = JSUint8Array::create(realm.global, structure, JSArrayBufferView::fastSizeLimit + 1);
    void* vector = large->vector();
    EXPECT(!large->hasVectorInHeap() && large->tryPin() && !large->hasArrayBuffer());
    realm.define("large"_s, large);
    EXPECT(realm.run("large[1000] = 3; large.buffer.transfer(0).byteLength === 0 && large.length === 0"_s).isTrue());
    EXPECT(static_cast<uint8_t*>(vector)[1000] == 3);
    large->unpin();

    auto* bytes = static_cast<uint8_t*>(fastMalloc(8));
    memcpy(bytes, someBytes, 8);
    auto* adopted = JSUint8Array::createAdopted(realm.vm, structure, { bytes, 8 });
    realm.define("adopted"_s, adopted);
    realm.collect();
    EXPECT(adopted->vector() == bytes && realm.run("adopted.join('') === '12345678'"_s).isTrue());
    EXPECT(adopted->possiblySharedBuffer()->data() == bytes);
    EXPECT(adopted->possiblySharedJSBuffer(realm.global) == realm.run("adopted.buffer"_s));

    EXPECT(!JSUint8Array::create(realm.global, structure, MAX_ARRAY_BUFFER_SIZE + 1));
    EXPECT(realm.takeException() == "RangeError: Out of memory"_s);
}

TEST(ViewOnBuffer)
{
    Realm realm;
    auto* structure = realm.global->typedArrayStructureWithTypedArrayType<TypeInt32>();
    auto create = [&](size_t byteOffset, std::optional<size_t> length) { return JSInt32Array::create(realm.global, structure, ArrayBuffer::create(someBytes), byteOffset, length); };

    EXPECT(create(4, 1)->typedVector()[0] == 0x08070605);
    EXPECT(!create(4, 2) && realm.takeException() == "RangeError: Length out of range of buffer"_s);
    EXPECT(!create(9, 0) && realm.takeException() == "RangeError: Length out of range of buffer"_s);
    EXPECT(!create(2, 1) && realm.takeException() == "RangeError: Byte offset is not aligned"_s);
    EXPECT(!JSInt32Array::create(realm.global, structure, ArrayBuffer::createFromBytes({}, nullptr), 0, 0));
    EXPECT(realm.takeException() == makeString("TypeError: "_s, typedArrayBufferHasBeenDetachedErrorMessage));

    auto* dataView = JSDataView::create(realm.global, realm.global->typedArrayStructure(TypeDataView, false), ArrayBuffer::create(someBytes), 1, 3);
    realm.define("dataView"_s, dataView);
    EXPECT(dataView->byteLength() == 3 && dataView->classInfo() == JSDataView::info() && realm.run("dataView.getUint8(0) === 2"_s).isTrue());
}

TEST(ViewOnResizableBuffer)
{
    Realm realm;
    auto* buffer = downcast<JSArrayBuffer>(realm.run("globalThis.buffer = new ArrayBuffer(8, { maxByteLength: 32 })"_s))->impl();
    auto* tracking = downcast<JSUint16Array>(realm.run("globalThis.tracking = new Uint16Array(buffer, 2)"_s));
    auto* fixed = downcast<JSUint16Array>(realm.run("globalThis.fixed = new Uint16Array(buffer, 2, 2)"_s));
    EXPECT(tracking->isAutoLength() && tracking->length() == 3 && !fixed->isAutoLength() && fixed->length() == 2);
    EXPECT(!JSArrayBufferView::toWrappedAllowShared(realm.vm, fixed));

    auto trackingImpl = tracking->possiblySharedImpl();
    realm.run("buffer.resize(17)"_s);
    EXPECT(tracking->length() == 7 && tracking->byteLength() == 14 && trackingImpl->byteLength() == 14);

    realm.run("buffer.resize(5)"_s);
    EXPECT(fixed->isOutOfBounds() && !fixed->isDetached() && !fixed->length() && !fixed->byteOffset());
    auto fixedImpl = fixed->possiblySharedImpl();
    EXPECT(!fixedImpl->byteLength() && !fixedImpl->byteOffset() && fixedImpl->byteLengthRaw() == 4 && fixedImpl->byteOffsetRaw() == 2);
    realm.define("copy"_s, fixedImpl->wrap(realm.global, realm.global));
    EXPECT(realm.run("const before = copy.length; buffer.resize(8); before === 0 && copy.length === 2 && copy.byteOffset === 2"_s).isTrue());
    EXPECT(fixed->length() == 2 && fixed->byteOffset() == 2);

    EXPECT(Uint8Array::wrappedAs(*buffer, 8, 24));
    EXPECT(!Uint8Array::wrappedAs(*buffer, 8, 25));
    EXPECT(!DataView::wrappedAs(*buffer, 33, std::nullopt));
}

TEST(ViewWithStructureOfSubclass)
{
    Realm realm;
    auto* subclass = downcast<JSObject>(realm.run("globalThis.Bytes = class extends Uint8Array {}"_s));
    auto* structure = InternalFunction::createSubclassStructure(realm.global, subclass, realm.global->typedArrayStructureWithTypedArrayType<TypeUint8>());
    realm.define("plain"_s, JSUint8Array::create(realm.global, structure, 2));
    realm.define("resizable"_s, JSUint8Array::create(realm.global, structure, ArrayBuffer::tryCreate(2, 1, 4), 0, std::nullopt));
    EXPECT(realm.run("plain instanceof Bytes && resizable instanceof Bytes"_s).isTrue());
    EXPECT(realm.run("resizable.buffer.resize(4); resizable.length === 4"_s).isTrue());
}

TEST(ViewOutsideTheHeap)
{
    Realm realm;
    auto array = Uint8Array::tryCreate(someBytes, 8);
    EXPECT(array->byteLength() == 8 && array->data()[7] == 8);
    realm.define("array"_s, array->wrap(realm.global, realm.global));
    EXPECT(realm.run("array instanceof Uint8Array && array[7] === 8"_s).isTrue());

    JSValue floats = realm.run("globalThis.floats = new Float32Array([1, 2])"_s);
    EXPECT(!JSUint8Array::toWrapped(realm.vm, floats) && !JSDataView::toWrapped(realm.vm, floats));
    auto impl = JSArrayBufferView::toWrapped(realm.vm, floats);
    realm.define("other"_s, impl->wrap(realm.global, realm.global));
    EXPECT(realm.run("other instanceof Float32Array && other !== floats && other.buffer === floats.buffer && other[1] === 2"_s).isTrue());

    realm.run("floats.buffer.transfer()"_s);
    EXPECT(!impl->possiblySharedBuffer() && !impl->data() && !impl->byteLength());
    EXPECT(JSArrayBufferView::toWrapped(realm.vm, floats));
    EXPECT(!impl->wrap(realm.global, realm.global) && realm.takeException().startsWith("TypeError"_s));

    JSValue shared = realm.run("new DataView(new SharedArrayBuffer(4))"_s);
    EXPECT(!JSDataView::toWrapped(realm.vm, shared) && !JSArrayBufferView::toWrapped(realm.vm, shared));
    EXPECT(JSArrayBufferView::toWrappedAllowShared(realm.vm, shared)->byteLength() == 4);
}

TEST(TypedArraySet)
{
    Realm realm;
    auto* target = downcast<JSUint8Array>(realm.run("globalThis.target = new Uint8Array(4)"_s));
    EXPECT(target->setFromTypedArray(realm.global, 1, downcast<JSArrayBufferView>(realm.run("new Float64Array([9, 257, 3.5])"_s)), 1, 2, CopyType::LeftToRight));
    EXPECT(realm.run("target.join() === '0,1,3,0'"_s).isTrue());
    EXPECT(target->setFromArrayLike(realm.global, 2, downcast<JSObject>(realm.run("[1, '5', { valueOf: () => 6 }]"_s)), 1, 2));
    EXPECT(realm.run("target.join() === '0,1,5,6'"_s).isTrue());

    EXPECT(!target->setFromArrayLike(realm.global, 3, downcast<JSObject>(realm.run("[1, 2]"_s)), 0, 2));
    EXPECT(realm.takeException() == "RangeError: Range consisting of offset and length are out of bounds"_s);
    EXPECT(!target->setFromTypedArray(realm.global, 0, downcast<JSArrayBufferView>(realm.run("new BigInt64Array(1)"_s)), 0, 1, CopyType::LeftToRight));
    EXPECT(realm.takeException().startsWith("TypeError"_s));
}

TEST(ExternalBytesAreFreedOnce)
{
    unsigned freed = 0;
    {
        Realm realm;
        auto* structure = realm.global->typedArrayStructureWithTypedArrayType<TypeUint8>();
        realm.define("kept"_s, JSUint8Array::create(realm.global, structure, ArrayBuffer::createFromBytes(someBytes, count, &freed), 0, 8));
        realm.collect();
        EXPECT(!freed);
    }
    EXPECT(freed == 1);
}
