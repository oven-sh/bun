#pragma once

// Array buffers and the views on them.

#include "engine/api/GlobalObject.h"

using JSTypedArrayBytesDeallocator = void (*)(void* bytes, void* context);

#define MAX_ARRAY_BUFFER_SIZE static_cast<unsigned long long>(Engine::Layout::maxArrayBufferSize)

// clang-format off
// In the order of the types of the cells.
#define FOR_EACH_TYPED_ARRAY_TYPE_EXCLUDING_DATA_VIEW(macro) \
    macro(Int8)                                              \
    macro(Uint8)                                             \
    macro(Uint8Clamped)                                      \
    macro(Int16)                                             \
    macro(Uint16)                                            \
    macro(Int32)                                             \
    macro(Uint32)                                            \
    macro(Float16)                                           \
    macro(Float32)                                           \
    macro(Float64)                                           \
    macro(BigInt64)                                          \
    macro(BigUint64)

namespace JSC {

enum TypedArrayType : uint8_t {
    NotTypedArray,
#define ENGINE_TYPE(name) Type##name = name##ArrayType - Int8ArrayType + 1,
    FOR_EACH_TYPED_ARRAY_TYPE_EXCLUDING_DATA_VIEW(ENGINE_TYPE)
#undef ENGINE_TYPE
    TypeDataView = DataViewType - Int8ArrayType + 1,
};
// clang-format on

constexpr TypedArrayType typedArrayType(JSType type) { return isTypedArrayTypeIncludingDataView(type) ? static_cast<TypedArrayType>(type - Int8ArrayType + 1) : NotTypedArray; }
constexpr unsigned logElementSize(TypedArrayType type) { return type == NotTypedArray ? 0 : Engine::Layout::packedElementSizeShifts >> (type - TypeInt8) * 2 & 3; }
constexpr size_t elementSize(TypedArrayType type) { return size_t { 1 } << logElementSize(type); }

inline Structure* JSGlobalObject::typedArrayStructure(TypedArrayType type, bool isResizableOrGrowableShared) const
{
    static_assert(Engine::RealmSlot::data_view_shape - Engine::RealmSlot::int8_array_shape == TypeDataView - TypeInt8);
    static_assert(Engine::RealmSlot::resizable_data_view_shape - Engine::RealmSlot::resizable_int8_array_shape == TypeDataView - TypeInt8);
    ASSERT(type != NotTypedArray);
    uint16_t first = isResizableOrGrowableShared ? Engine::RealmSlot::resizable_int8_array_shape : Engine::RealmSlot::int8_array_shape;
    return lazySlot<Structure>(first + type - TypeInt8);
}

inline constexpr ASCIILiteral typedArrayBufferHasBeenDetachedErrorMessage = "Underlying ArrayBuffer has been detached from the view or out-of-bounds"_s;

enum class ArrayBufferSharingMode : bool { Default,
    Shared };

using ArrayBufferDestructorFunction = RefPtr<SharedTask<void(void*)>>;

// The memory of an array buffer, which can move from one buffer to another and from thread to thread.
class ArrayBufferContents {
    WTF_MAKE_NONCOPYABLE(ArrayBufferContents);

public:
    ArrayBufferContents() { clear(); }
    ArrayBufferContents(ArrayBufferContents&& other) { take(other); }
    ArrayBufferContents& operator=(ArrayBufferContents&& other)
    {
        if (this != &other) {
            release();
            take(other);
        }
        return *this;
    }
    ~ArrayBufferContents() { release(); }

    explicit operator bool() const { return m_data; }
    void* data() const { return m_data; }
    size_t sizeInBytes() const
    {
        if (m_isResizable && isShared()) [[unlikely]]
            return m_sharedByteLength->load();
        return m_byteLength;
    }
    std::optional<size_t> maxByteLength() const { return m_isResizable ? std::optional(m_maxByteLength) : std::nullopt; }
    bool isShared() const { return m_backing == Engine::Layout::sharedBacking; }
    bool isResizableOrGrowableShared() const { return m_isResizable; }

    // False unless the memory is shared.
    bool shareWith(ArrayBufferContents& result) const { return Engine::array_buffer_contents_share(*this, result); }

private:
    static void checkLayout();

    void clear() { memset(static_cast<void*>(this), 0, sizeof(*this)); }
    void take(ArrayBufferContents& other)
    {
        memcpy(static_cast<void*>(this), static_cast<const void*>(&other), sizeof(*this));
        other.clear();
    }
    void release()
    {
        if (m_backing)
            Engine::array_buffer_contents_destroy(this);
    }

    void* m_data;
    size_t m_byteLength;
    size_t m_maxByteLength;
    uint8_t m_backing;
    [[maybe_unused]] Engine::Opaque<8> m_owner;
    const std::atomic<size_t>* m_sharedByteLength;
    bool m_isResizable;
};

inline void ArrayBufferContents::checkLayout()
{
    ENGINE_CHECK_SIZE(ArrayBufferContents, sizeOfArrayBufferContents);
    ENGINE_CHECK_OFFSET(ArrayBufferContents, m_data, ArrayBufferContents_data);
    ENGINE_CHECK_OFFSET(ArrayBufferContents, m_byteLength, ArrayBufferContents_byte_length);
    ENGINE_CHECK_OFFSET(ArrayBufferContents, m_maxByteLength, ArrayBufferContents_max_byte_length);
    ENGINE_CHECK_OFFSET(ArrayBufferContents, m_backing, ArrayBufferContents_backing);
    ENGINE_CHECK_OFFSET(ArrayBufferContents, m_sharedByteLength, ArrayBufferContents_shared_byte_length);
    ENGINE_CHECK_OFFSET(ArrayBufferContents, m_isResizable, ArrayBufferContents_is_resizable);
}

// What an `ArrayBuffer` object and the views on it share. From the first of them on it belongs to their thread.
class ArrayBuffer {
public:
    ArrayBuffer() = delete;
    ~ArrayBuffer() = delete;

    static RefPtr<ArrayBuffer> tryCreate(size_t count, unsigned elementSize, std::optional<size_t> maxByteLength = std::nullopt)
    {
        size_t byteLength = saturatedProduct(count, elementSize);
        return maxByteLength ? Engine::array_buffer_try_resizable(byteLength, *maxByteLength) : Engine::array_buffer_try_zeroed(byteLength);
    }
    static RefPtr<ArrayBuffer> tryCreate(std::span<const uint8_t> bytes = {})
    {
        auto buffer = tryCreateUninitialized(bytes.size(), 1);
        if (buffer)
            memcpySpan(buffer->mutableSpan(), bytes);
        return buffer;
    }
    static RefPtr<ArrayBuffer> tryCreateUninitialized(size_t count, unsigned elementSize) { return Engine::array_buffer_try_uninitialized(saturatedProduct(count, elementSize)); }
    static Ref<ArrayBuffer> create(size_t count, unsigned elementSize) { return orCrash(tryCreate(count, elementSize)); }
    static Ref<ArrayBuffer> create(std::span<const uint8_t> bytes = {}) { return orCrash(tryCreate(bytes)); }
    static Ref<ArrayBuffer> create(ArrayBufferContents&& contents) { return Engine::array_buffer_from_contents(contents); }
    static Ref<ArrayBuffer> createUninitialized(size_t count, unsigned elementSize) { return orCrash(tryCreateUninitialized(count, elementSize)); }
    // Of fastMalloc() or of the default allocator of Rust, which is the same.
    static Ref<ArrayBuffer> createAdopted(std::span<const uint8_t> bytes) { return Engine::array_buffer_adopt(bytes.data(), bytes.size()); }
    // It is detached if there is no address. The thread that lets go of the bytes last frees them.
    static Ref<ArrayBuffer> createFromBytes(std::span<const uint8_t> bytes, JSTypedArrayBytesDeallocator deallocator, void* context) { return Engine::array_buffer_external(bytes.data(), bytes.size(), deallocator, context); }
    static Ref<ArrayBuffer> createFromBytes(std::span<const uint8_t> bytes, ArrayBufferDestructorFunction&& destructor)
    {
        if (!destructor)
            return createFromBytes(bytes, nullptr, nullptr);
        auto run = [](void* data, void* context) { adoptRef(*static_cast<SharedTask<void(void*)>*>(context))->run(data); };
        return createFromBytes(bytes, run, destructor.leakRef());
    }

    void ref() const { refCount().fetch_add(1, std::memory_order_relaxed); }
    void deref() const
    {
        if (refCount().fetch_sub(1, std::memory_order_acq_rel) == 1)
            Engine::array_buffer_destroy(this);
    }

    // Null if it is detached.
    void* data() { return contents().data(); }
    const void* data() const { return contents().data(); }
    size_t byteLength() const { return contents().sizeInBytes(); }
    std::optional<size_t> maxByteLength() const { return contents().maxByteLength(); }
    std::span<const uint8_t> span() const { return { static_cast<const uint8_t*>(data()), byteLength() }; }
    std::span<uint8_t> mutableSpan() { return { static_cast<uint8_t*>(data()), byteLength() }; }

    bool isDetached() const { return !contents(); }
    bool isShared() const { return contents().isShared(); }
    ArrayBufferSharingMode sharingMode() const { return isShared() ? ArrayBufferSharingMode::Shared : ArrayBufferSharingMode::Default; }
    bool isResizableOrGrowableShared() const { return contents().isResizableOrGrowableShared(); }
    bool isResizableNonShared() const { return isResizableOrGrowableShared() && !isShared(); }
    bool isWasmMemory() const { return Engine::array_buffer_is_wasm_memory(*this); }
    // The object that stands for the buffer, if there is one.
    JSArrayBuffer* wrapper() const { return Engine::fieldAt<JSArrayBuffer*>(this, Engine::Layout::ArrayBuffer_wrapper); }

    // Before any object refers to it.
    void makeShared() { Engine::array_buffer_make_shared(*this); }
    bool shareWith(ArrayBufferContents& result) const { return contents().shareWith(result); }

    // While it is pinned, the bytes that it has stay where they are. A memory of WebAssembly may go on elsewhere.
    void pin() { Engine::array_buffer_pin(*this); }
    void unpin() { Engine::array_buffer_unpin(*this); }
    bool isDetachable() const { return Engine::array_buffer_is_detachable(*this); }
    void detach(VM& vm) { Engine::array_buffer_detach(*this, vm); }
    // One that is not detachable stays as it is and gives a share or a copy of its memory.
    bool transferTo(VM& vm, ArrayBufferContents& result) { return Engine::array_buffer_transfer(*this, vm, result); }

private:
    static size_t saturatedProduct(size_t count, unsigned elementSize)
    {
        size_t product;
        return __builtin_mul_overflow(count, elementSize, &product) ? std::numeric_limits<size_t>::max() : product;
    }
    static Ref<ArrayBuffer> orCrash(RefPtr<ArrayBuffer>&& buffer)
    {
        if (!buffer) [[unlikely]]
            Support__outOfMemory();
        return buffer.releaseNonNull();
    }

    std::atomic<uint32_t>& refCount() const { return Engine::fieldAt<std::atomic<uint32_t>>(this, Engine::Layout::ArrayBuffer_ref_count); }
    const ArrayBufferContents& contents() const { return Engine::fieldAt<ArrayBufferContents>(this, Engine::Layout::ArrayBuffer_contents); }
};

// An `ArrayBuffer` or a `SharedArrayBuffer`.
class JSArrayBuffer final : public JSNonFinalObject {
public:
    ENGINE_DECLARE_CLASS(ArrayBuffer)

    // Becomes the object that stands for the buffer.
    static JSArrayBuffer* create(VM& vm, Structure* structure, RefPtr<ArrayBuffer>&& buffer) { return Engine::js_array_buffer_create(vm, structure, *buffer); }
    // The object that stands for the buffer, which is made in that realm if there is none.
    static JSArrayBuffer* wrap(JSGlobalObject* globalObject, ArrayBuffer& buffer)
    {
        if (auto* wrapper = buffer.wrapper())
            return wrapper;
        return Engine::js_array_buffer_create(globalObject->vm(), globalObject->arrayBufferStructure(buffer.sharingMode()), buffer);
    }

    ArrayBuffer* impl() const { return Engine::fieldAt<ArrayBuffer*>(this, Engine::Layout::JsArrayBuffer_buffer); }
    bool isShared() const { return impl()->isShared(); }
    bool isResizableOrGrowableShared() const { return impl()->isResizableOrGrowableShared(); }

    static ArrayBuffer* toWrapped(VM&, JSValue);
    static ArrayBuffer* toWrappedAllowShared(VM&, JSValue);
};
ENGINE_CLASS_HAS_TYPE(JSArrayBuffer, ArrayBufferType);

inline ArrayBuffer* toPossiblySharedArrayBuffer(VM&, JSValue value)
{
    auto* wrapper = dynamicDowncast<JSArrayBuffer>(value);
    return wrapper ? wrapper->impl() : nullptr;
}

inline ArrayBuffer* toUnsharedArrayBuffer(VM& vm, JSValue value)
{
    auto* buffer = toPossiblySharedArrayBuffer(vm, value);
    return buffer && !buffer->isShared() ? buffer : nullptr;
}

inline ArrayBuffer* JSArrayBuffer::toWrapped(VM& vm, JSValue value)
{
    auto* buffer = toUnsharedArrayBuffer(vm, value);
    return buffer && !buffer->isResizableOrGrowableShared() ? buffer : nullptr;
}

inline ArrayBuffer* JSArrayBuffer::toWrappedAllowShared(VM& vm, JSValue value)
{
    auto* buffer = toPossiblySharedArrayBuffer(vm, value);
    return buffer && !buffer->isResizableOrGrowableShared() ? buffer : nullptr;
}

// A part of a buffer and the type of its elements, outside the heap. The classes for each type add no fields.
class ArrayBufferView : public RefCounted<ArrayBufferView> {
public:
    RefPtr<ArrayBuffer> possiblySharedBuffer() const { return m_buffer->isDetached() ? nullptr : m_buffer.ptr(); }
    bool isResizableOrGrowableShared() const { return m_buffer->isResizableOrGrowableShared(); }
    bool isAutoLength() const { return !m_byteLength; }

    // Whether or not the buffer has these bytes.
    size_t byteOffsetRaw() const { return m_byteOffset; }
    size_t byteLengthRaw() const { return m_byteLength.value_or(0); }
    // Zero if it does not.
    size_t byteOffset() const { return currentByteLength() ? m_byteOffset : 0; }
    size_t byteLength() const { return currentByteLength().value_or(0); }
    void* data() const { return m_buffer->isDetached() ? nullptr : static_cast<uint8_t*>(m_buffer->data()) + m_byteOffset; }

    // A new object.
    JSArrayBufferView* wrap(JSGlobalObject* lexicalGlobalObject, JSGlobalObject* globalObject);

protected:
    // In elements.
    ArrayBufferView(TypedArrayType type, Ref<ArrayBuffer>&& buffer, size_t byteOffset, std::optional<size_t> length)
        : m_type(type)
        , m_buffer(WTF::move(buffer))
        , m_byteOffset(byteOffset)
        , m_byteLength(length.transform([&](size_t length) { return length << logElementSize(type); }))
    {
        ASSERT(length || isResizableOrGrowableShared());
    }

    // Inside what the buffer has or can come to have.
    static bool isValidRange(TypedArrayType type, const ArrayBuffer& buffer, size_t byteOffset, std::optional<size_t> length)
    {
        // Views on it are empty in any case.
        if (buffer.isDetached() && buffer.isResizableOrGrowableShared())
            return true;
        size_t limit = buffer.maxByteLength().value_or(buffer.byteLength());
        return byteOffset <= limit && length.value_or(0) <= (limit - byteOffset) >> logElementSize(type) && !(byteOffset & (elementSize(type) - 1));
    }

private:
    std::optional<size_t> currentByteLength() const
    {
        size_t bufferByteLength = m_buffer->byteLength();
        if (m_buffer->isDetached() || m_byteOffset > bufferByteLength) [[unlikely]]
            return std::nullopt;
        size_t available = bufferByteLength - m_byteOffset;
        if (!m_byteLength) [[unlikely]]
            return available & ~(elementSize(m_type) - 1);
        return *m_byteLength <= available ? m_byteLength : std::nullopt;
    }

    const TypedArrayType m_type;
    const Ref<ArrayBuffer> m_buffer;
    const size_t m_byteOffset;
    const std::optional<size_t> m_byteLength;
};

template<typename Adaptor> class GenericTypedArrayView final : public ArrayBufferView {
public:
    using ElementType = typename Adaptor::Type;

    static RefPtr<GenericTypedArrayView> wrappedAs(Ref<ArrayBuffer>&& buffer, size_t byteOffset, std::optional<size_t> length)
    {
        if (!isValidRange(Adaptor::typeValue, buffer, byteOffset, length))
            return nullptr;
        return adoptRef(*new GenericTypedArrayView(Adaptor::typeValue, WTF::move(buffer), byteOffset, length));
    }
    static RefPtr<GenericTypedArrayView> tryCreate(const ElementType* elements, size_t length)
    {
        auto buffer = ArrayBuffer::tryCreate(asByteSpan(std::span(elements, length)));
        return buffer ? wrappedAs(buffer.releaseNonNull(), 0, length) : nullptr;
    }

    ElementType* data() const { return static_cast<ElementType*>(ArrayBufferView::data()); }

private:
    using ArrayBufferView::ArrayBufferView;
};

class DataView final : public ArrayBufferView {
public:
    static RefPtr<DataView> wrappedAs(Ref<ArrayBuffer>&& buffer, size_t byteOffset, std::optional<size_t> byteLength)
    {
        if (!isValidRange(TypeDataView, buffer, byteOffset, byteLength))
            return nullptr;
        return adoptRef(*new DataView(TypeDataView, WTF::move(buffer), byteOffset, byteLength));
    }

private:
    using ArrayBufferView::ArrayBufferView;
};

enum class CopyType : uint8_t {
    LeftToRight = Engine::CopyOrder::Ascending,
    Unobservable = Engine::CopyOrder::AtOnce,
};

// A typed array or a `DataView`.
class JSArrayBufferView : public JSNonFinalObject {
public:
    ENGINE_DECLARE_CLASS(ArrayBufferView)

    // Up to so many elements are kept in the heap until a buffer is asked for.
    static constexpr size_t fastSizeLimit = Engine::Layout::maxSmallViewLength;

    static constexpr ptrdiff_t offsetOfVector() { return Engine::Layout::JsArrayBufferView_vector; }
    static constexpr ptrdiff_t offsetOfLength() { return Engine::Layout::JsArrayBufferView_length; }

    bool hasArrayBuffer() const { return mode() & Engine::ViewMode::HAS_BUFFER; }
    bool hasVectorInHeap() const { return !mode(); }
    bool isShared() const { return mode() & Engine::ViewMode::SHARED; }
    bool isResizableOrGrowableShared() const { return mode() & Engine::ViewMode::RESIZABLE_OR_GROWABLE; }
    bool isAutoLength() const { return mode() & Engine::ViewMode::AUTO_LENGTH; }
    bool isDetached() const { return !vector(); }
    bool isOutOfBounds() const
    {
        if (isResizableOrGrowableShared()) [[unlikely]]
            return Engine::view_is_out_of_bounds(this);
        return isDetached();
    }

    // Null if the buffer is detached. If it is in the heap, it changes when the view gets a buffer.
    ALWAYS_INLINE void* vector() const { return Engine::fieldAt<void*>(this, Engine::Layout::JsArrayBufferView_vector); }
    // Zero if it is out of bounds.
    ALWAYS_INLINE size_t length() const
    {
        if (isResizableOrGrowableShared()) [[unlikely]]
            return Engine::view_length(this);
        return Engine::fieldAt<size_t>(this, Engine::Layout::JsArrayBufferView_length);
    }
    ALWAYS_INLINE size_t byteLength() const { return length() << (Engine::Layout::packedElementSizeShifts >> (type() - Int8ArrayType) * 2 & 3); }
    size_t byteOffset() const
    {
        if (isResizableOrGrowableShared() && Engine::view_is_out_of_bounds(this)) [[unlikely]]
            return 0;
        return byteOffsetRaw();
    }
    std::span<const uint8_t> span() const { return { static_cast<const uint8_t*>(vector()), byteLength() }; }

    ArrayBuffer* existingBuffer() const { return hasArrayBuffer() ? Engine::fieldAt<ArrayBuffer*>(this, Engine::Layout::JsArrayBufferView_buffer) : nullptr; }
    // Makes one if there is none. Null if there is no memory for it.
    ArrayBuffer* possiblySharedBuffer()
    {
        if (auto* buffer = existingBuffer())
            return buffer;
        return Engine::view_create_buffer(this);
    }
    ArrayBuffer* unsharedBuffer()
    {
        RELEASE_ASSERT(!isShared());
        return possiblySharedBuffer();
    }
    JSArrayBuffer* possiblySharedJSBuffer(JSGlobalObject* globalObject) { return Engine::view_js_buffer(this, globalObject); }
    RefPtr<ArrayBufferView> possiblySharedImpl();

    // As those of the buffer, without making one for elements that do not move anyway. One that is made later can be
    // detached, which leaves the elements where they are. A destructor may unpin.
    bool tryPin() { return Engine::view_try_pin(this); }
    void unpin() { Engine::view_unpin(this); }

    static RefPtr<ArrayBufferView> toWrapped(VM&, JSValue);
    static RefPtr<ArrayBufferView> toWrappedAllowShared(VM&, JSValue);

protected:
    static JSArrayBufferView* create(JSGlobalObject* globalObject, Structure* structure, ArrayBuffer& buffer, size_t byteOffset, std::optional<size_t> length) { return Engine::view_create_on_buffer(globalObject, structure, buffer, byteOffset, length.value_or(0), !!length); }

    template<typename View> RefPtr<View> wrappedAs()
    {
        auto* buffer = possiblySharedBuffer();
        return buffer ? View::wrappedAs(*buffer, byteOffsetRaw(), declaredLength()) : nullptr;
    }

private:
    ALWAYS_INLINE uint8_t mode() const { return Engine::fieldAt<uint8_t>(this, Engine::Layout::JsArrayBufferView_mode); }

    // What it was made with, whether or not the buffer has that now.
    size_t byteOffsetRaw() const { return Engine::fieldAt<uint64_t>(this, Engine::Layout::JsArrayBufferView_byte_offset_and_mode) & Engine::Layout::byteOffsetMask; }
    std::optional<size_t> declaredLength() const
    {
        if (!isResizableOrGrowableShared()) [[likely]]
            return length();
        if (isAutoLength())
            return std::nullopt;
        return Engine::fieldAt<size_t>(this, Engine::Layout::JsArrayBufferView_declared_length);
    }
};
ENGINE_CLASS_HAS_TYPES(JSArrayBufferView, Int8ArrayType, DataViewType);

inline RefPtr<ArrayBufferView> JSArrayBufferView::toWrapped(VM&, JSValue value)
{
    auto* view = dynamicDowncast<JSArrayBufferView>(value);
    return view && !view->isShared() && !view->isResizableOrGrowableShared() ? view->possiblySharedImpl() : nullptr;
}

inline RefPtr<ArrayBufferView> JSArrayBufferView::toWrappedAllowShared(VM&, JSValue value)
{
    auto* view = dynamicDowncast<JSArrayBufferView>(value);
    return view && !view->isResizableOrGrowableShared() ? view->possiblySharedImpl() : nullptr;
}

template<typename Adaptor> class JSGenericTypedArrayView final : public JSArrayBufferView {
public:
    using ElementType = typename Adaptor::Type;

    static constexpr TypedArrayType TypedArrayStorageType = Adaptor::typeValue;
    static constexpr const ClassInfo& s_info = Adaptor::classInfo;
    static constexpr const ClassInfo* info() { return &s_info; }

    static JSGenericTypedArrayView* create(JSGlobalObject* globalObject, Structure* structure, size_t length) { return cast(Engine::typed_array_create(globalObject, structure, length)); }
    static JSGenericTypedArrayView* createUninitialized(JSGlobalObject* globalObject, Structure* structure, size_t length) { return cast(Engine::typed_array_create_uninitialized(globalObject, structure, length)); }
    // As that of ArrayBuffer, without making one.
    static JSGenericTypedArrayView* createAdopted(VM& vm, Structure* structure, std::span<const uint8_t> bytes)
        requires(TypedArrayStorageType == TypeUint8)
    {
        return cast(Engine::uint8_array_adopt(vm, structure, bytes.data(), bytes.size()));
    }
    // Without a length it reaches to the end of the buffer.
    static JSGenericTypedArrayView* create(JSGlobalObject* globalObject, Structure* structure, RefPtr<ArrayBuffer>&& buffer, size_t byteOffset, std::optional<size_t> length) { return createOn(globalObject, structure, *buffer, byteOffset, length); }
    // For the buffer of an object that is alive.
    static JSGenericTypedArrayView* createOn(JSGlobalObject* globalObject, Structure* structure, ArrayBuffer& buffer, size_t byteOffset, std::optional<size_t> length) { return cast(JSArrayBufferView::create(globalObject, structure, buffer, byteOffset, length)); }

    size_t byteLength() const { return length() * sizeof(ElementType); }
    std::span<const uint8_t> span() const { return { static_cast<const uint8_t*>(vector()), byteLength() }; }
    ElementType* typedVector() { return static_cast<ElementType*>(vector()); }
    const ElementType* typedVector() const { return static_cast<const ElementType*>(vector()); }
    std::span<ElementType> typedSpan() { return { typedVector(), length() }; }

    // False if they throw.
    bool setFromTypedArray(JSGlobalObject* globalObject, size_t offset, JSArrayBufferView* source, size_t sourceOffset, size_t length, CopyType type) { return Engine::typed_array_set_from_typed_array(this, globalObject, offset, source, sourceOffset, length, std::to_underlying(type)); }
    bool setFromArrayLike(JSGlobalObject* globalObject, size_t offset, JSObject* source, size_t sourceOffset, size_t length) { return Engine::typed_array_set_from_object(this, globalObject, offset, source, sourceOffset, length); }

    static RefPtr<GenericTypedArrayView<Adaptor>> toWrapped(VM&, JSValue value)
    {
        auto* view = dynamicDowncast<JSGenericTypedArrayView>(value);
        return view && !view->isShared() && !view->isResizableOrGrowableShared() ? view->template wrappedAs<GenericTypedArrayView<Adaptor>>() : nullptr;
    }

private:
    static JSGenericTypedArrayView* cast(JSArrayBufferView* view)
    {
        ASSERT(!view || typedArrayType(view->type()) == TypedArrayStorageType);
        return static_cast<JSGenericTypedArrayView*>(view);
    }
};

#define ENGINE_TYPED_ARRAY(name, type)                                            \
    extern "C" const ClassInfo engine_class_##name##Array;                        \
    struct name##Adaptor {                                                        \
        using Type = type;                                                        \
        static constexpr TypedArrayType typeValue = Type##name;                   \
        static constexpr const ClassInfo& classInfo = engine_class_##name##Array; \
    };                                                                            \
    using name##Array = GenericTypedArrayView<name##Adaptor>;                     \
    using JS##name##Array = JSGenericTypedArrayView<name##Adaptor>;               \
    ENGINE_CLASS_HAS_TYPE(JS##name##Array, name##ArrayType);                      \
    static_assert(sizeof(type) == elementSize(Type##name))
ENGINE_TYPED_ARRAY(Int8, int8_t);
ENGINE_TYPED_ARRAY(Uint8, uint8_t);
ENGINE_TYPED_ARRAY(Uint8Clamped, uint8_t);
ENGINE_TYPED_ARRAY(Int16, int16_t);
ENGINE_TYPED_ARRAY(Uint16, uint16_t);
ENGINE_TYPED_ARRAY(Int32, int32_t);
ENGINE_TYPED_ARRAY(Uint32, uint32_t);
ENGINE_TYPED_ARRAY(Float16, Float16);
ENGINE_TYPED_ARRAY(Float32, float);
ENGINE_TYPED_ARRAY(Float64, double);
ENGINE_TYPED_ARRAY(BigInt64, int64_t);
ENGINE_TYPED_ARRAY(BigUint64, uint64_t);
#undef ENGINE_TYPED_ARRAY

class JSDataView final : public JSArrayBufferView {
public:
    ENGINE_DECLARE_CLASS(DataView)

    static JSDataView* create(JSGlobalObject* globalObject, Structure* structure, RefPtr<ArrayBuffer>&& buffer, size_t byteOffset, std::optional<size_t> byteLength) { return static_cast<JSDataView*>(JSArrayBufferView::create(globalObject, structure, *buffer, byteOffset, byteLength)); }

    static RefPtr<DataView> toWrapped(VM&, JSValue);
};
ENGINE_CLASS_HAS_TYPE(JSDataView, DataViewType);

inline RefPtr<DataView> JSDataView::toWrapped(VM&, JSValue value)
{
    auto* view = dynamicDowncast<JSDataView>(value);
    return view && !view->isShared() && !view->isResizableOrGrowableShared() ? view->wrappedAs<DataView>() : nullptr;
}

// What a function with BufferAccessorIntrinsic reads or writes.
struct BufferAccessorDescriptor {
    // Zero if an argument says.
    uint8_t byteSize;
    bool isSigned;
    bool isFloatingPoint;
    bool isLittleEndian;
    bool isWrite;
};
ENGINE_CHECK_SIZE(BufferAccessorDescriptor, sizeOfBufferAccessor);
ENGINE_CHECK_OFFSET(BufferAccessorDescriptor, isSigned, BufferAccessor_is_signed);
ENGINE_CHECK_OFFSET(BufferAccessorDescriptor, isFloatingPoint, BufferAccessor_is_float);
ENGINE_CHECK_OFFSET(BufferAccessorDescriptor, isLittleEndian, BufferAccessor_is_little_endian);
ENGINE_CHECK_OFFSET(BufferAccessorDescriptor, isWrite, BufferAccessor_is_write);

inline void registerBufferAccessor(NativeFunction function, const BufferAccessorDescriptor& descriptor) { Engine::buffer_accessor_register(descriptor, function); }

} // namespace JSC

using JSC::ArrayBuffer;
using JSC::ArrayBufferView;
#define ENGINE_USING(name) using JSC::name##Array;
FOR_EACH_TYPED_ARRAY_TYPE_EXCLUDING_DATA_VIEW(ENGINE_USING)
#undef ENGINE_USING
