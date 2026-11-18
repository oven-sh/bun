#pragma once

// What all cells of a native type have in common, and how to tell the type of a cell.

#include "engine/api/Cell.h"

namespace JSC {

struct CallData {
    enum class Type : size_t {
        None = Engine::CallKind::None,
        Native = Engine::CallKind::Native,
        JS = Engine::CallKind::Script,
    };

    CallData()
        : js { nullptr, nullptr }
    {
    }

    Type type { Type::None };
    union {
        struct {
            TaggedNativeFunction function;
            bool isBoundFunction;
            bool isWasm;
        } native;
        struct {
            FunctionExecutable* functionExecutable;
            JSScope* scope;
        } js;
    };
};
ENGINE_CHECK_SIZE(CallData, sizeOfCallData);
ENGINE_CHECK_OFFSET(CallData, js.functionExecutable, CallData_target);
ENGINE_CHECK_OFFSET(CallData, js.scope, CallData_detail);

inline CallData JSCell::getCallData(JSCell*) { return {}; }
inline CallData JSCell::getConstructData(JSCell*) { return {}; }

#if ENABLE(EXCEPTION_SCOPE_VERIFICATION)
template<typename> struct ThrowingMethod;
template<typename Result, typename Cell, typename... Arguments> struct ThrowingMethod<Result(Cell*, JSGlobalObject*, Arguments...)> {
    using Pointer = Result (*)(Cell*, JSGlobalObject*, Arguments...);

    constexpr ThrowingMethod(Pointer pointer)
        : pointer(pointer)
    {
    }

    Result operator()(Cell* cell, JSGlobalObject* globalObject, Arguments... arguments) const
    {
        Engine::MayThrow mayThrow(globalObject, true, "a method of an object");
        return pointer(cell, globalObject, arguments...);
    }
    friend bool operator==(ThrowingMethod, ThrowingMethod) = default;

    Pointer pointer;
};
#else
template<typename Signature> using ThrowingMethod = Signature*;
#endif

struct MethodTable {
    void (*destroy)(JSCell*);
    void (*fillCallData)(JSCell*, CallData&);
    void (*fillConstructData)(JSCell*, CallData&);
    ThrowingMethod<bool(JSCell*, JSGlobalObject*, PropertyName, JSValue, PutPropertySlot&)> put;
    ThrowingMethod<bool(JSCell*, JSGlobalObject*, unsigned, JSValue, bool shouldThrow)> putByIndex;
    ThrowingMethod<bool(JSCell*, JSGlobalObject*, PropertyName, DeletePropertySlot&)> deleteProperty;
    ThrowingMethod<bool(JSCell*, JSGlobalObject*, unsigned)> deletePropertyByIndex;
    ThrowingMethod<bool(JSObject*, JSGlobalObject*, PropertyName, PropertySlot&)> getOwnPropertySlot;
    ThrowingMethod<bool(JSObject*, JSGlobalObject*, unsigned, PropertySlot&)> getOwnPropertySlotByIndex;
    ThrowingMethod<void(JSObject*, JSGlobalObject*, PropertyNameArrayBuilder&, DontEnumPropertiesMode)> getOwnPropertyNames;
    ThrowingMethod<void(JSObject*, JSGlobalObject*, PropertyNameArrayBuilder&, DontEnumPropertiesMode)> getOwnSpecialPropertyNames;
    ThrowingMethod<bool(JSObject*, JSGlobalObject*, JSValue)> customHasInstance;
    ThrowingMethod<bool(JSObject*, JSGlobalObject*, PropertyName, const PropertyDescriptor&, bool shouldThrow)> defineOwnProperty;
    ThrowingMethod<bool(JSObject*, JSGlobalObject*)> preventExtensions;
    ThrowingMethod<bool(JSObject*, JSGlobalObject*)> isExtensible;
    ThrowingMethod<bool(JSObject*, JSGlobalObject*, JSValue, bool shouldThrow)> setPrototype;
    EncodedJSValue (*getEncodedPrototype)(JSObject*, JSGlobalObject*);
    void (*analyzeHeap)(JSCell*, HeapAnalyzer&);
    size_t (*estimatedSize)(JSCell*, VM&);
    void (*visitChildren)(JSCell*, SlotVisitor&);
    void (*visitOutputConstraints)(JSCell*, SlotVisitor&);
    void (*reconcileWeakReferences)(JSCell*, const Engine::Survivors&);

    // Not every calling convention returns a class as it returns what Rust has in its place.
    template<CallData (*method)(JSCell*)> static void fill(JSCell* cell, CallData& result) { result = method(cell); }
    template<JSValue (*method)(JSObject*, JSGlobalObject*)> static EncodedJSValue encode(JSObject* object, JSGlobalObject* globalObject) { return JSValue::encode(method(object, globalObject)); }
};
ENGINE_CHECK_SIZE(MethodTable, sizeOfClassOps);
ENGINE_CHECK_OFFSET(MethodTable, destroy, ClassOps_destroy);
ENGINE_CHECK_OFFSET(MethodTable, fillCallData, ClassOps_call_data);
ENGINE_CHECK_OFFSET(MethodTable, fillConstructData, ClassOps_construct_data);
ENGINE_CHECK_OFFSET(MethodTable, put, ClassOps_put);
ENGINE_CHECK_OFFSET(MethodTable, putByIndex, ClassOps_put_by_index);
ENGINE_CHECK_OFFSET(MethodTable, deleteProperty, ClassOps_delete_property);
ENGINE_CHECK_OFFSET(MethodTable, deletePropertyByIndex, ClassOps_delete_property_by_index);
ENGINE_CHECK_OFFSET(MethodTable, getOwnPropertySlot, ClassOps_get_own_property_slot);
ENGINE_CHECK_OFFSET(MethodTable, getOwnPropertySlotByIndex, ClassOps_get_own_property_slot_by_index);
ENGINE_CHECK_OFFSET(MethodTable, getOwnPropertyNames, ClassOps_own_property_names);
ENGINE_CHECK_OFFSET(MethodTable, getOwnSpecialPropertyNames, ClassOps_own_special_property_names);
ENGINE_CHECK_OFFSET(MethodTable, customHasInstance, ClassOps_custom_has_instance);
ENGINE_CHECK_OFFSET(MethodTable, defineOwnProperty, ClassOps_define_own_property);
ENGINE_CHECK_OFFSET(MethodTable, preventExtensions, ClassOps_prevent_extensions);
ENGINE_CHECK_OFFSET(MethodTable, isExtensible, ClassOps_is_extensible);
ENGINE_CHECK_OFFSET(MethodTable, setPrototype, ClassOps_set_prototype_of);
ENGINE_CHECK_OFFSET(MethodTable, getEncodedPrototype, ClassOps_get_prototype_of);
ENGINE_CHECK_OFFSET(MethodTable, analyzeHeap, ClassOps_analyze_heap);
ENGINE_CHECK_OFFSET(MethodTable, estimatedSize, ClassOps_estimated_size);
ENGINE_CHECK_OFFSET(MethodTable, visitChildren, ClassOps_visit_children);
ENGINE_CHECK_OFFSET(MethodTable, visitOutputConstraints, ClassOps_visit_output_constraints);
ENGINE_CHECK_OFFSET(MethodTable, reconcileWeakReferences, ClassOps_reconcile_weak_references);

struct ClassInfo {
    bool isSubClassOf(const ClassInfo* other) const
    {
        for (const ClassInfo* info = this; info; info = info->parentClass) {
            if (info == other)
                return true;
        }
        return false;
    }

    ASCIILiteral className;
    const ClassInfo* parentClass;
    const HashTable* staticPropHashTable;
    const void* reserved;
    JSTypeRange types;
    bool isOfEmbedder;
    unsigned staticClassSize;
    MethodTable methodTable;
};
ENGINE_CHECK_OFFSET(ClassInfo, parentClass, Class_parent);
ENGINE_CHECK_OFFSET(ClassInfo, staticPropHashTable, Class_static_table);
ENGINE_CHECK_OFFSET(ClassInfo, types, Class_types);
ENGINE_CHECK_OFFSET(ClassInfo, isOfEmbedder, Class_is_of_embedder);
ENGINE_CHECK_OFFSET(ClassInfo, staticClassSize, Class_size);
ENGINE_CHECK_OFFSET(ClassInfo, methodTable, Class_ops);

#define CREATE_METHOD_TABLE(ClassName)                               \
    { ::JSC::StructureType, ::JSC::CellType },                       \
        true,                                                        \
        sizeof(ClassName),                                           \
    {                                                                \
        &ClassName::destroy,                                         \
            &::JSC::MethodTable::fill<&ClassName::getCallData>,      \
            &::JSC::MethodTable::fill<&ClassName::getConstructData>, \
            &ClassName::put,                                         \
            &ClassName::putByIndex,                                  \
            &ClassName::deleteProperty,                              \
            &ClassName::deletePropertyByIndex,                       \
            &ClassName::getOwnPropertySlot,                          \
            &ClassName::getOwnPropertySlotByIndex,                   \
            &ClassName::getOwnPropertyNames,                         \
            &ClassName::getOwnSpecialPropertyNames,                  \
            &ClassName::customHasInstance,                           \
            &ClassName::defineOwnProperty,                           \
            &ClassName::preventExtensions,                           \
            &ClassName::isExtensible,                                \
            &ClassName::setPrototype,                                \
            &::JSC::MethodTable::encode<&ClassName::getPrototype>,   \
            &ClassName::analyzeHeap,                                 \
            &ClassName::estimatedSize,                               \
            &ClassName::visitChildren,                               \
            &ClassName::visitOutputConstraints,                      \
            &ClassName::reconcileWeakReferences,                     \
    }

inline const MethodTable* JSCell::methodTable() const { return &classInfo()->methodTable; }
inline ASCIILiteral JSCell::className() const { return classInfo()->className; }
inline bool JSCell::inherits(const ClassInfo* info) const { return classInfo()->isSubClassOf(info); }
inline size_t JSCell::estimatedSizeInBytes(VM& vm) const { return methodTable()->estimatedSize(const_cast<JSCell*>(this), vm); }

namespace JSCastingHelpers {

template<typename To> struct InheritsTraits {
    static bool inherits(const JSCell* from)
    {
        if constexpr (std::is_final_v<To>)
            return from->classInfo() == To::info();
        else
            return from->inherits(To::info());
    }
};

template<typename To, typename From> bool inheritsJSTypeImpl(From* from, JSTypeRange range) { return range.contains(from->type()); }

} // namespace JSCastingHelpers

// In namespace JSC, before the first cast to a class: these types mean the class or one that extends it.
#define ENGINE_CLASS_HAS_TYPES(ClassName, first, last)                                                          \
    template<> struct JSCastingHelpers::InheritsTraits<ClassName> {                                             \
        static bool inherits(const JSCell* from) { return JSTypeRange { first, last }.contains(from->type()); } \
    }
#define ENGINE_CLASS_HAS_TYPE(ClassName, type) ENGINE_CLASS_HAS_TYPES(ClassName, type, type)

template<typename Target> bool JSCell::inherits() const { return JSCastingHelpers::InheritsTraits<Target>::inherits(this); }

} // namespace JSC

template<typename T>
concept IsJSCellType = requires { T::info(); };

namespace WTF {

template<typename To, typename From>
    requires(IsJSCellType<std::remove_const_t<To>> && (IsJSCellType<std::remove_const_t<From>> || std::is_same_v<std::remove_const_t<From>, JSC::JSCell>))
struct TypeCastTraits<To, From, false> {
    static bool isOfType(From& source) { return JSC::JSCastingHelpers::InheritsTraits<std::remove_const_t<To>>::inherits(&source); }
};

// Each has an overload for a value that is not const, which would otherwise go to the one for any reference.
template<IsJSCellType To> ALWAYS_INLINE bool is(const JSC::JSValue& value) { return value.inherits<To>(); }
template<IsJSCellType To> ALWAYS_INLINE bool is(JSC::JSValue& value) { return value.inherits<To>(); }

template<IsJSCellType To> ALWAYS_INLINE To* dynamicDowncast(const JSC::JSValue& value) { return value.inherits<To>() ? static_cast<To*>(value.asCell()) : nullptr; }
template<IsJSCellType To> ALWAYS_INLINE To* dynamicDowncast(JSC::JSValue& value) { return dynamicDowncast<To>(std::as_const(value)); }

template<IsJSCellType To> ALWAYS_INLINE To* downcast(const JSC::JSValue& value)
{
    RELEASE_ASSERT(value.inherits<To>());
    return static_cast<To*>(value.asCell());
}
template<IsJSCellType To> ALWAYS_INLINE To* downcast(JSC::JSValue& value) { return downcast<To>(std::as_const(value)); }

template<IsJSCellType To> ALWAYS_INLINE To* uncheckedDowncast(const JSC::JSValue& value)
{
    ASSERT(value.isCell() && (!value || value.inherits<To>()));
    return static_cast<To*>(value.asCell());
}
template<IsJSCellType To> ALWAYS_INLINE To* uncheckedDowncast(JSC::JSValue& value) { return uncheckedDowncast<To>(std::as_const(value)); }

} // namespace WTF

using WTF::downcast;
using WTF::dynamicDowncast;
using WTF::is;
using WTF::uncheckedDowncast;
