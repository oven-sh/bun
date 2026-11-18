#pragma once

// The header of everything that the collector manages.

#include "engine/api/Exports.h"

namespace JSC {

class HeapCell {
public:
    Heap* heap() const
    {
        using namespace Engine::Layout;
        uintptr_t address = reinterpret_cast<uintptr_t>(this);
        if (address & preciseBit) [[unlikely]]
            return Engine::fieldAt<Heap*>(this, PreciseAllocation_heap - preciseHeaderSize);
        return *reinterpret_cast<Heap**>((address & ~(blockSize - 1)) + Block_heap);
    }

    VM& vm() const { return Engine::fieldAt<VM>(heap(), -Engine::Layout::Vm_heap); }
    bool isPendingDestruction() const { return !Engine::cell_is_live(reinterpret_cast<const JSC::JSCell*>(this)); }
};

// Keeps a marker from reading what a cell owns while it is rearranged. It has the address of the cell.
class JSCellLock {
public:
    void lock()
    {
        if (!tryLock()) [[unlikely]]
            Engine::cell_lock(reinterpret_cast<JSCell*>(this));
    }
    bool tryLock() { return !(bits().fetch_or(Engine::Layout::cellIsLocked, std::memory_order_acquire) & Engine::Layout::cellIsLocked); }
    void unlock() { bits().fetch_and(static_cast<uint8_t>(~Engine::Layout::cellIsLocked), std::memory_order_release); }

private:
    std::atomic<uint8_t>& bits() const { return Engine::fieldAt<std::atomic<uint8_t>>(this, Engine::Layout::JsCell_indexing_mode); }
};

#define DECLARE_INFO                      \
protected:                                \
    static const ::JSC::ClassInfo s_info; \
                                          \
public:                                   \
    static constexpr const ::JSC::ClassInfo* info() { return &s_info; }

#define DECLARE_EXPORT_INFO DECLARE_INFO

// For a class that Rust declares with `#[cell(export = "engine_class_<name>")]`.
#define ENGINE_DECLARE_CLASS(name)                                           \
protected:                                                                   \
    static const ::JSC::ClassInfo s_info ENGINE_SYMBOL(engine_class_##name); \
                                                                             \
public:                                                                      \
    static constexpr const ::JSC::ClassInfo* info() { return &s_info; }

#if ASSERT_ENABLED
#define DECLARE_DEFAULT_FINISH_CREATION            \
    ALWAYS_INLINE void finishCreation(JSC::VM& vm) \
    {                                              \
        Base::finishCreation(vm);                  \
        ASSERT(this->inherits(info()));            \
    }                                              \
    static_assert(true)
#else
#define DECLARE_DEFAULT_FINISH_CREATION using Base::finishCreation
#endif

#define ASSERT_GC_OBJECT_INHERITS(object, classInfo) ASSERT((object)->JSC::JSCell::inherits(classInfo))
#define STATIC_ASSERT_IS_TRIVIALLY_DESTRUCTIBLE(type) static_assert(std::is_trivially_destructible_v<type>)

class JSCell : public HeapCell {
    WTF_MAKE_NONCOPYABLE(JSCell);
    WTF_MAKE_NONMOVABLE(JSCell);

public:
    static constexpr unsigned StructureFlags = 0;
    static constexpr DestructionMode needsDestruction = DoesNotNeedDestruction;

    void* operator new(size_t, NotNullTag, void* location) { return location; }
    void* operator new(size_t, void* location) { return location; }

    static constexpr ptrdiff_t typeInfoTypeOffset() { return Engine::Layout::JsCell_type; }

    StructureID structureID() const { return m_structureID; }
    Structure* structure() const { return m_structureID.decode(); }
    JSType type() const { return m_type; }
    TypeInfo::InlineTypeFlags inlineTypeFlags() const { return m_flags; }
    IndexingType indexingType() const { return indexingTypeOfHeader(m_indexingModeAndLock); }
    bool perCellBit() const { return m_flags & TypeInfoPerCellBit; }
    void setPerCellBit(bool value) { m_flags = (m_flags & ~TypeInfoPerCellBit) | (value ? TypeInfoPerCellBit : 0); }
    uint8_t cellState() const { return __atomic_load_n(&m_state, __ATOMIC_RELAXED); }
    JSCellLock& cellLock() const { return Engine::fieldAt<JSCellLock>(this, 0); }

    const ClassInfo* classInfo() const { return Engine::fieldAt<const ClassInfo*>(m_structureID.decode(), Engine::Layout::Shape_instance_class); }
    const MethodTable* methodTable() const;
    ASCIILiteral className() const;
    bool inherits(const ClassInfo*) const;
    bool inheritsSlow(const ClassInfo* info) const { return inherits(info); }
    template<typename Target> bool inherits() const;

    bool isString() const { return m_type == StringType; }
    bool isSymbol() const { return m_type == SymbolType; }
    bool isHeapBigInt() const { return m_type == HeapBigIntType; }
    bool isObject() const { return m_type >= ObjectType; }
    bool isGetterSetter() const { return m_type == GetterSetterType; }
    bool isCustomGetterSetter() const { return m_type == CustomGetterSetterType; }
    bool isProxy() const { return m_type == GlobalProxyType || m_type == ProxyObjectType; }
    bool isCallable() const
    {
        if (m_type == JSFunctionType || m_type == InternalFunctionType)
            return true;
        return (m_flags & OverridesGetCallData) && Engine::value_is_callable(this);
    }
    bool isConstructor() const { return Engine::value_is_constructor(this); }

    JSObject* getObject() { return isObject() ? reinterpret_cast<JSObject*>(this) : nullptr; }
    String getString(JSGlobalObject*) const;
    JSObject* toObject(JSGlobalObject* globalObject) const { return JSValue(this).toObject(globalObject); }
    JSString* toStringInline(JSGlobalObject* globalObject) const { return JSValue(this).toString(globalObject); }
    bool putInline(JSGlobalObject* globalObject, PropertyName name, JSValue value, PutPropertySlot& slot) { return Engine::value_put(this, globalObject, name, value, slot); }
    static bool deleteProperty(JSCell*, JSGlobalObject*, PropertyName);
    static bool canUseFastGetOwnProperty(const Structure&);
    JSValue fastGetOwnProperty(VM&, Structure&, PropertyName);
    size_t estimatedSizeInBytes(VM&) const;

    static void destroy(JSCell*) {}
    static CallData getCallData(JSCell*);
    static CallData getConstructData(JSCell*);
    static size_t estimatedSize(JSCell*, VM&) ENGINE_SYMBOL(engine_Cell_estimated_size);
    static void analyzeHeap(JSCell*, HeapAnalyzer&) {}
    static void visitChildren(JSCell*, SlotVisitor&) ENGINE_SYMBOL(engine_Cell_visit_children);
    static void visitChildren(JSCell*, AbstractSlotVisitor&) ENGINE_SYMBOL(engine_Cell_visit_children);
    static void visitOutputConstraints(JSCell*, SlotVisitor&) {}
    static void visitOutputConstraints(JSCell*, AbstractSlotVisitor&) {}
    static void reconcileWeakReferences(JSCell*, const Engine::Survivors&) {}

    // Only objects have these.
    static bool put(JSCell*, JSGlobalObject*, PropertyName, JSValue, PutPropertySlot&) { RELEASE_ASSERT_NOT_REACHED(); }
    static bool putByIndex(JSCell*, JSGlobalObject*, unsigned, JSValue, bool) { RELEASE_ASSERT_NOT_REACHED(); }
    static bool deleteProperty(JSCell*, JSGlobalObject*, PropertyName, DeletePropertySlot&) { RELEASE_ASSERT_NOT_REACHED(); }
    static bool deletePropertyByIndex(JSCell*, JSGlobalObject*, unsigned) { RELEASE_ASSERT_NOT_REACHED(); }
    static bool getOwnPropertySlot(JSObject*, JSGlobalObject*, PropertyName, PropertySlot&) { RELEASE_ASSERT_NOT_REACHED(); }
    static bool getOwnPropertySlotByIndex(JSObject*, JSGlobalObject*, unsigned, PropertySlot&) { RELEASE_ASSERT_NOT_REACHED(); }
    static void getOwnPropertyNames(JSObject*, JSGlobalObject*, PropertyNameArrayBuilder&, DontEnumPropertiesMode) { RELEASE_ASSERT_NOT_REACHED(); }
    static void getOwnSpecialPropertyNames(JSObject*, JSGlobalObject*, PropertyNameArrayBuilder&, DontEnumPropertiesMode) {}
    static bool customHasInstance(JSObject*, JSGlobalObject*, JSValue) { RELEASE_ASSERT_NOT_REACHED(); }
    static bool defineOwnProperty(JSObject*, JSGlobalObject*, PropertyName, const PropertyDescriptor&, bool) { RELEASE_ASSERT_NOT_REACHED(); }
    static bool preventExtensions(JSObject*, JSGlobalObject*) { RELEASE_ASSERT_NOT_REACHED(); }
    static bool isExtensible(JSObject*, JSGlobalObject*) { RELEASE_ASSERT_NOT_REACHED(); }
    static bool setPrototype(JSObject*, JSGlobalObject*, JSValue, bool) { RELEASE_ASSERT_NOT_REACHED(); }
    static JSValue getPrototype(JSObject*, JSGlobalObject*) { RELEASE_ASSERT_NOT_REACHED(); }

protected:
    ALWAYS_INLINE JSCell(VM&, Structure* structure)
    {
        uint64_t header = StructureID::encode(structure).bits() | static_cast<uint64_t>(Engine::fieldAt<uint32_t>(structure, Engine::Layout::Shape_instance_header)) << 32;
        memcpy(static_cast<void*>(this), &header, sizeof(header));
    }

    void finishCreation(VM&);

    // How the elements are really kept.
    uint8_t elementKind() const { return m_indexingModeAndLock & IndexingShapeMask; }
    uint8_t elementKindAndWritability() const { return m_indexingModeAndLock & (IndexingShapeMask | CopyOnWrite | Engine::Layout::slowPut); }

private:
    friend struct CellLayout;

    StructureID m_structureID;
    uint8_t m_indexingModeAndLock;
    JSType m_type;
    TypeInfo::InlineTypeFlags m_flags;
    uint8_t m_state;
};

struct CellLayout {
    ENGINE_CHECK_SIZE(JSCell, sizeOfJsCell);
    ENGINE_CHECK_OFFSET(JSCell, m_structureID, JsCell_shape_id);
    ENGINE_CHECK_OFFSET(JSCell, m_indexingModeAndLock, JsCell_indexing_mode);
    ENGINE_CHECK_OFFSET(JSCell, m_type, JsCell_type);
    ENGINE_CHECK_OFFSET(JSCell, m_flags, JsCell_flags);
    ENGINE_CHECK_OFFSET(JSCell, m_state, JsCell_state);
};

// The empty value is for the caller to rule out.
ALWAYS_INLINE bool JSValue::isString() const { return isCell() && asCell()->isString(); }
ALWAYS_INLINE bool JSValue::isSymbol() const { return isCell() && asCell()->isSymbol(); }
ALWAYS_INLINE bool JSValue::isHeapBigInt() const { return isCell() && asCell()->isHeapBigInt(); }
ALWAYS_INLINE bool JSValue::isObject() const { return isCell() && asCell()->isObject(); }
ALWAYS_INLINE bool JSValue::isGetterSetter() const { return isCell() && asCell()->isGetterSetter(); }
ALWAYS_INLINE bool JSValue::isCustomGetterSetter() const { return isCell() && asCell()->isCustomGetterSetter(); }
inline bool JSValue::isCallable() const { return isCell() && asCell()->isCallable(); }
inline bool JSValue::isConstructor() const { return isCell() && asCell()->isConstructor(); }
inline bool JSValue::inherits(const ClassInfo* classInfo) const { return isCell() && asCell()->inherits(classInfo); }
template<typename Target> bool JSValue::inherits() const { return isCell() && asCell()->inherits<Target>(); }
inline const ClassInfo* JSValue::classInfoOrNull() const { return isCell() ? asCell()->classInfo() : nullptr; }
inline Structure* JSValue::structureOrNull() const { return isCell() ? asCell()->structure() : nullptr; }
ALWAYS_INLINE JSObject* JSValue::getObject() const { return isCell() ? asCell()->getObject() : nullptr; }

} // namespace JSC
