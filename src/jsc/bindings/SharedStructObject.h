#pragma once

#include "root.h"
#include "BunClientData.h"

#include <JavaScriptCore/JSDestructibleObject.h>
#include <wtf/HashMap.h>
#include <wtf/Locker.h>
#include <wtf/Vector.h>
#include <optional>

// Rust, in src/shared_struct_jsc/shared_struct_classes.rs. A `block` is a `const SharedBlock*`: the view owns one strong count of it.
extern "C" {
// The JSValue of slot `index`, or empty with an exception pending. `*key` gets the address of the object the slot holds, or null for a
// primitive. When that address is `cachedKey`, the result is `cached` and nothing is built.
JSC::EncodedJSValue Bun__SharedBlock__load(const void* block, size_t index, JSC::JSGlobalObject*, const void* cachedKey, JSC::EncodedJSValue cached, const void** key);
// False with an exception pending when `value` cannot be shared. `*key` gets the address of the object that was stored, or null for a primitive.
bool Bun__SharedBlock__store(const void* block, size_t index, JSC::JSGlobalObject*, JSC::EncodedJSValue value, const void** key);
void Bun__SharedBlock__release(const void* block);
size_t Bun__SharedBlock__length(const void* block);
bool Bun__SharedBlock__isStruct(const void* block);
// The UTF-16 name of field `index` of a shared struct. It lives as long as the block.
void Bun__SharedBlock__fieldName(const void* block, size_t index, const char16_t** chars, size_t* length);
}

namespace Bun {

// A JS object that is a thin view over a `SharedBlock`. Every worker that holds the block has its own view; reads and writes
// go to the block's atomic slots and nowhere else, so there is nothing to copy. The one thing the GC traces is a cache of the last
// wrapper object (a view, Mutex or Condition) that each slot was given or handed out, so that `a.x = b; a.x === b` and `s.x === s.x`.
//
// A slot is a writable, enumerable, non-configurable data property. A view has a null prototype and is not extensible.
class JSSharedView : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;
    static constexpr unsigned StructureFlags = Base::StructureFlags
        | JSC::OverridesGetOwnPropertySlot
        | JSC::OverridesPut
        | JSC::OverridesGetOwnPropertyNames
        | JSC::GetOwnPropertySlotMayBeWrongAboutDontEnum
        | JSC::ProhibitsPropertyCaching;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::CompleteSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.destructibleObjectSpace();
    }

    DECLARE_VISIT_CHILDREN;

    const void* block() const { return m_block; }

    // Slot `index` as a JS value, or empty with an exception pending. An object that is still what the slot holds comes from the cache.
    JSC::JSValue load(JSC::JSGlobalObject*, size_t index);
    // False with an exception pending when `value` cannot be shared.
    bool store(JSC::JSGlobalObject*, size_t index, JSC::JSValue value);
    // Records that slot `index` holds the object at `key`, whose wrapper is `object`; a null `key` or `object` clears the entry.
    void remember(JSC::VM&, size_t index, const void* key, JSC::JSObject* object);
    // The wrapper of the object at `key` if slot `index` last gave it out or took it in, else null.
    JSC::JSObject* cachedWrapper(size_t index, const void* key) const;

protected:
    JSSharedView(JSC::VM& vm, JSC::Structure* structure, const void* block)
        : Base(vm, structure)
        , m_block(block)
    {
        WTF::Locker locker { cellLock() };
        m_cache.grow(Bun__SharedBlock__length(block));
    }
    ~JSSharedView() { Bun__SharedBlock__release(m_block); }

    // `Object.defineProperty` on a slot: the only change a script can make is its value.
    bool redefineSlot(JSC::JSGlobalObject*, size_t index, const JSC::PropertyDescriptor&, bool shouldThrow);

    // The wrapper that slot `index` last gave out or took in, and the address of the object behind it. The address is checked on every
    // read, because another thread may have changed the slot. The size is fixed at construction, which the GC relies on.
    struct SlotCache {
        JSC::WriteBarrier<JSC::JSObject> wrapper;
        const void* key { nullptr };
    };

    const void* const m_block;
    WTF::Vector<SlotCache> m_cache;
};

// `new SharedStruct(["a", "b"])`: one slot for each name, found by the identifier of the property.
class JSSharedStruct final : public JSSharedView {
public:
    using Base = JSSharedView;
    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::InterceptsGetOwnPropertySlotByIndexEvenWhenLengthIsNotZero;

    DECLARE_INFO;

    static JSSharedStruct* create(JSC::VM&, JSC::JSGlobalObject*, const void* block);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        return Bun::createClassStructure(vm, globalObject, JSC::jsNull(), JSC::TypeInfo(JSC::ObjectType, StructureFlags), info(), JSC::NonArray | JSC::MayHaveIndexedAccessors);
    }

    static void destroy(JSC::JSCell* cell) { static_cast<JSSharedStruct*>(cell)->~JSSharedStruct(); }
    ~JSSharedStruct() = default;

    static bool getOwnPropertySlot(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::PropertySlot&);
    // A field named by an array index ("0", "7") is read and written by index.
    static bool getOwnPropertySlotByIndex(JSC::JSObject*, JSC::JSGlobalObject*, unsigned, JSC::PropertySlot&);
    static bool put(JSC::JSCell*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::JSValue, JSC::PutPropertySlot&);
    static bool putByIndex(JSC::JSCell*, JSC::JSGlobalObject*, unsigned, JSC::JSValue, bool shouldThrow);
    static bool defineOwnProperty(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, const JSC::PropertyDescriptor&, bool shouldThrow);
    static bool deleteProperty(JSC::JSCell*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::DeletePropertySlot&);
    static bool deletePropertyByIndex(JSC::JSCell*, JSC::JSGlobalObject*, unsigned);
    static void getOwnPropertyNames(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyNameArrayBuilder&, JSC::DontEnumPropertiesMode);

private:
    JSSharedStruct(JSC::VM& vm, JSC::Structure* structure, const void* block)
        : Base(vm, structure, block)
    {
    }
    void finishCreation(JSC::VM&);

    // The slot of a field, if `name` is one.
    std::optional<size_t> slotOf(JSC::PropertyName) const;

    WTF::Vector<JSC::Identifier> m_names;
    WTF::HashMap<WTF::UniquedStringImpl*, size_t> m_slots;
};

// `new SharedArray(length)`: integer-indexed slots and a read-only `length`.
class JSSharedArray final : public JSSharedView {
public:
    using Base = JSSharedView;
    static constexpr unsigned StructureFlags = Base::StructureFlags | JSC::InterceptsGetOwnPropertySlotByIndexEvenWhenLengthIsNotZero;

    DECLARE_INFO;

    static JSSharedArray* create(JSC::VM&, JSC::JSGlobalObject*, const void* block);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        return Bun::createClassStructure(vm, globalObject, JSC::jsNull(), JSC::TypeInfo(JSC::ObjectType, StructureFlags), info(), JSC::NonArray | JSC::MayHaveIndexedAccessors);
    }

    static void destroy(JSC::JSCell* cell) { static_cast<JSSharedArray*>(cell)->~JSSharedArray(); }
    ~JSSharedArray() = default;

    static bool getOwnPropertySlot(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::PropertySlot&);
    static bool getOwnPropertySlotByIndex(JSC::JSObject*, JSC::JSGlobalObject*, unsigned, JSC::PropertySlot&);
    static bool put(JSC::JSCell*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::JSValue, JSC::PutPropertySlot&);
    static bool putByIndex(JSC::JSCell*, JSC::JSGlobalObject*, unsigned, JSC::JSValue, bool shouldThrow);
    static bool defineOwnProperty(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, const JSC::PropertyDescriptor&, bool shouldThrow);
    static bool deleteProperty(JSC::JSCell*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::DeletePropertySlot&);
    static bool deletePropertyByIndex(JSC::JSCell*, JSC::JSGlobalObject*, unsigned);
    static void getOwnPropertyNames(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyNameArrayBuilder&, JSC::DontEnumPropertiesMode);

private:
    JSSharedArray(JSC::VM& vm, JSC::Structure* structure, const void* block)
        : Base(vm, structure, block)
        , m_length(Bun__SharedBlock__length(block))
    {
    }
    void finishCreation(JSC::VM&);

    const size_t m_length;
};

}
