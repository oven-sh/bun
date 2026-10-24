#pragma once

#include "root.h"
#include "BunClientData.h"

#include <JavaScriptCore/JSDestructibleObject.h>
#include <wtf/HashMap.h>
#include <wtf/Vector.h>
#include <optional>

// Rust, in src/shared_struct_jsc/shared_struct_classes.rs. A `block` is a `const SharedBlock*`: the view owns one strong count of it.
extern "C" {
// The JSValue of slot `index`, or empty with an exception pending.
JSC::EncodedJSValue Bun__SharedBlock__load(const void* block, size_t index, JSC::JSGlobalObject*);
// False with an exception pending when `value` cannot be shared.
bool Bun__SharedBlock__store(const void* block, size_t index, JSC::JSGlobalObject*, JSC::EncodedJSValue value);
void Bun__SharedBlock__release(const void* block);
size_t Bun__SharedBlock__length(const void* block);
bool Bun__SharedBlock__isStruct(const void* block);
// The UTF-16 name of field `index` of a shared struct. It lives as long as the block.
void Bun__SharedBlock__fieldName(const void* block, size_t index, const char16_t** chars, size_t* length);
}

namespace Bun {

// A JS object that is a thin view over a `SharedBlock`. Every worker that holds the block has its own view; reads and writes
// go to the block's atomic slots and nowhere else, so there is nothing to copy and nothing for the GC to trace.
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

    const void* block() const { return m_block; }

protected:
    JSSharedView(JSC::VM& vm, JSC::Structure* structure, const void* block)
        : Base(vm, structure)
        , m_block(block)
    {
    }
    ~JSSharedView() { Bun__SharedBlock__release(m_block); }

    // `Object.defineProperty` on a slot: the only change a script can make is its value.
    bool redefineSlot(JSC::JSGlobalObject*, size_t index, const JSC::PropertyDescriptor&, bool shouldThrow);

    const void* const m_block;
};

// `new SharedStruct(["a", "b"])`: one slot for each name, found by the identifier of the property.
class JSSharedStruct final : public JSSharedView {
public:
    using Base = JSSharedView;

    DECLARE_INFO;

    static JSSharedStruct* create(JSC::VM&, JSC::JSGlobalObject*, const void* block);
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        return Bun::createClassStructure(vm, globalObject, JSC::jsNull(), JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static void destroy(JSC::JSCell* cell) { static_cast<JSSharedStruct*>(cell)->~JSSharedStruct(); }
    ~JSSharedStruct() = default;

    static bool getOwnPropertySlot(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::PropertySlot&);
    static bool put(JSC::JSCell*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::JSValue, JSC::PutPropertySlot&);
    static bool defineOwnProperty(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, const JSC::PropertyDescriptor&, bool shouldThrow);
    static bool deleteProperty(JSC::JSCell*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::DeletePropertySlot&);
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
