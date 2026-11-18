#pragma once

// Objects and their properties.

#include "engine/api/Structure.h"

namespace JSC {

EncodedJSValue SYSV_ABI callHostFunctionAsConstructor(JSGlobalObject*, CallFrame*) ENGINE_SYMBOL(engine_native_not_a_constructor);

class ObjectInitializationScope {
public:
    ObjectInitializationScope(VM& vm)
        : m_vm(vm)
    {
    }
    ~ObjectInitializationScope() { m_vm.mutatorFence(); }

    VM& vm() const { return m_vm; }

private:
    VM& m_vm;
};

class JSObject : public JSCell {
public:
    using Base = JSCell;

    ENGINE_DECLARE_CLASS(Object)

    static constexpr unsigned maximumPrototypeChainDepth = Engine::Layout::maxPrototypeChainDepth;

    static bool put(JSCell*, JSGlobalObject*, PropertyName, JSValue, PutPropertySlot&) ENGINE_SYMBOL(engine_Object_put);
    static bool putByIndex(JSCell*, JSGlobalObject*, unsigned, JSValue, bool shouldThrow) ENGINE_SYMBOL(engine_Object_put_by_index);
    static bool deleteProperty(JSCell*, JSGlobalObject*, PropertyName, DeletePropertySlot&) ENGINE_SYMBOL(engine_Object_delete_property);
    static bool deletePropertyByIndex(JSCell*, JSGlobalObject*, unsigned) ENGINE_SYMBOL(engine_Object_delete_property_by_index);
    static bool getOwnPropertySlot(JSObject*, JSGlobalObject*, PropertyName, PropertySlot&) ENGINE_SYMBOL(engine_Object_get_own_property_slot);
    static bool getOwnPropertySlotByIndex(JSObject*, JSGlobalObject*, unsigned, PropertySlot&) ENGINE_SYMBOL(engine_Object_get_own_property_slot_by_index);
    static void getOwnPropertyNames(JSObject*, JSGlobalObject*, PropertyNameArrayBuilder&, DontEnumPropertiesMode) ENGINE_SYMBOL(engine_Object_own_property_names);
    static bool defineOwnProperty(JSObject*, JSGlobalObject*, PropertyName, const PropertyDescriptor&, bool shouldThrow) ENGINE_SYMBOL(engine_Object_define_own_property);
    static bool preventExtensions(JSObject*, JSGlobalObject*) ENGINE_SYMBOL(engine_Object_prevent_extensions);
    static bool isExtensible(JSObject*, JSGlobalObject*) ENGINE_SYMBOL(engine_Object_is_extensible);
    static bool setPrototype(JSObject*, JSGlobalObject*, JSValue, bool shouldThrow) ENGINE_SYMBOL(engine_Object_set_prototype_of);
    static JSValue getPrototype(JSObject* object, JSGlobalObject*) { return object->getPrototypeDirect(); }
    static void analyzeHeap(JSCell*, HeapAnalyzer&) ENGINE_SYMBOL(engine_Object_analyze_heap);
    static size_t estimatedSize(JSCell*, VM&) ENGINE_SYMBOL(engine_Object_estimated_size);
    ENGINE_DECLARE_VISIT_CHILDREN(Object);

    JSGlobalObject* realm() const { return structure()->realm(); }
    JSGlobalObject* realmMayBeNull() const { return realm(); }
    JSGlobalObject* globalObject() const { return realm(); }
    bool isGlobalObject() const { return type() == GlobalObjectType; }
    bool isErrorInstance() const { return type() == ErrorInstanceType; }
    bool isStructureExtensible() const { return structure()->isStructureExtensible(); }
    static String calculatedClassName(JSObject* object) { return Engine::object_calculated_class_name(object); }

    JSValue getPrototypeDirect() const { return structure()->storedPrototype(); }
    ALWAYS_INLINE JSValue getPrototype(JSGlobalObject* globalObject)
    {
        if (!(inlineTypeFlags() & OverridesGetPrototype)) [[likely]]
            return getPrototypeDirect();
        return Engine::object_get_prototype_of(this, globalObject);
    }
    bool setPrototype(VM&, JSGlobalObject* globalObject, JSValue prototype, bool shouldThrow = false) { return Engine::object_set_prototype_of(this, globalObject, prototype, shouldThrow); }
    void setPrototypeDirect(VM& vm, JSValue prototype) { Engine::object_set_prototype_direct(this, vm, prototype); }
    void didBecomePrototype(VM& vm) { Engine::object_did_become_prototype(this, vm); }

    JSValue get(JSGlobalObject* globalObject, PropertyName name) const { return Engine::object_get(this, globalObject, name); }
    JSValue get(JSGlobalObject* globalObject, unsigned index) const { return getIndex(globalObject, index); }
    JSValue get(JSGlobalObject* globalObject, uint64_t index) const { return getIndex(globalObject, index); }
    ALWAYS_INLINE JSValue getIndex(JSGlobalObject* globalObject, uint64_t index) const
    {
        if (JSValue value = tryGetDense(index)) [[likely]]
            return value;
        return Engine::object_get_index(this, globalObject, index);
    }
    // Empty if there is no such property.
    JSValue getIfPropertyExists(JSGlobalObject* globalObject, PropertyName name) { return Engine::object_get_if_has_property(this, globalObject, name); }
    bool getPropertySlot(JSGlobalObject* globalObject, PropertyName name, PropertySlot& slot) { return Engine::object_get_property_slot(this, globalObject, name, slot, ENGINE_THROWS_ONLY_IF(!hasOrdinaryChain())); }
    bool getPropertySlot(JSGlobalObject* globalObject, unsigned index, PropertySlot& slot) { return Engine::object_get_property_slot_by_index(this, globalObject, index, slot); }
    bool getNonIndexPropertySlot(JSGlobalObject* globalObject, PropertyName name, PropertySlot& slot) { return Engine::object_get_non_index_property_slot(this, globalObject, name, slot); }
    bool getOwnPropertySlotInline(JSGlobalObject* globalObject, PropertyName name, PropertySlot& slot) { return Engine::object_get_own_property_slot(this, globalObject, name, slot, ENGINE_THROWS_ONLY_IF(ownLookupCanThrow())); }
    bool getOwnNonIndexPropertySlot(VM&, Structure*, PropertyName name, PropertySlot& slot) { return Engine::object_get_own_non_index_property_slot(this, name, slot); }
    bool getOwnPropertyDescriptor(JSGlobalObject* globalObject, PropertyName name, PropertyDescriptor& descriptor) { return Engine::object_get_own_property_descriptor(this, globalObject, name, descriptor); }
    bool hasProperty(JSGlobalObject* globalObject, PropertyName name) const { return Engine::object_has_property(this, globalObject, name, ENGINE_THROWS_ONLY_IF(!hasOrdinaryChain())); }
    bool hasProperty(JSGlobalObject* globalObject, unsigned index) const { return Engine::object_has_index(this, globalObject, index); }
    bool hasProperty(JSGlobalObject* globalObject, uint64_t index) const { return Engine::object_has_index(this, globalObject, index); }
    bool hasOwnProperty(JSGlobalObject* globalObject, PropertyName name) const { return Engine::object_has_own_property(this, globalObject, name, ENGINE_THROWS_ONLY_IF(ownLookupCanThrow())); }
    void getPropertyNames(JSGlobalObject* globalObject, PropertyNameArrayBuilder& names, DontEnumPropertiesMode mode) { Engine::object_property_names(this, globalObject, names, mode); }
    void getOwnNonIndexPropertyNames(JSGlobalObject* globalObject, PropertyNameArrayBuilder& names, DontEnumPropertiesMode mode) { Engine::object_own_non_index_property_names(this, globalObject, names, mode); }

    bool deleteProperty(JSGlobalObject* globalObject, PropertyName name) { return Engine::object_delete(this, globalObject, name, ENGINE_THROWS_ONLY_IF(ownLookupCanThrow())); }
    bool createDataProperty(JSGlobalObject* globalObject, PropertyName name, JSValue value, bool shouldThrow) { return Engine::object_create_data_property(this, globalObject, name, value, shouldThrow); }
    static bool definePropertyOnReceiver(JSGlobalObject* globalObject, PropertyName name, JSValue value, PutPropertySlot& slot) { return Engine::define_property_on_receiver(globalObject, name, value, slot); }
    void freeze(VM& vm) { Engine::object_freeze_ordinary(this, vm); }
    void convertToDictionary(VM& vm) { Engine::object_convert_to_dictionary(this, vm); }

    bool hasInstance(JSGlobalObject* globalObject, JSValue value) { return Engine::object_has_instance(this, globalObject, value); }
    static bool defaultHasInstance(JSGlobalObject* globalObject, JSValue value, JSValue prototype) { return Engine::default_has_instance(globalObject, value, prototype); }
    double toNumber(JSGlobalObject* globalObject) const { return Engine::value_to_number(this, globalObject); }
    JSString* toString(JSGlobalObject* globalObject) const { return JSValue(this).toString(globalObject); }

    bool staticPropertiesReified() const { return structure()->staticPropertiesReified(); }
    bool hasNonReifiedStaticProperties() const { return structure()->hasNonReifiedStaticProperties(); }
    void reifyAllStaticProperties(JSGlobalObject* globalObject) { Engine::object_reify_all_static_properties(this, globalObject); }
    std::optional<Structure::PropertyHashEntry> findPropertyHashEntry(PropertyName name) const { return structure()->findPropertyHashEntry(name); }

    // If not, it has no realm either, and the putDirect methods do nothing.
    bool canHaveProperties() const { return type() != WebAssemblyGCObjectType; }
    Butterfly* butterfly() const { return canHaveProperties() ? m_butterfly : nullptr; }
    PropertyStorage inlineStorage() const { return &Engine::fieldAt<WriteBarrierBase<Unknown>>(this, Engine::Layout::sizeOfJsObject); }
    ALWAYS_INLINE WriteBarrierBase<Unknown>* locationForOffset(PropertyOffset offset) const { return isInlineOffset(offset) ? inlineStorage() + offset : m_butterfly->outOfLineSlot(offset); }
    void setStructure(VM&, Structure* structure) { Engine::object_set_shape(this, structure); }

    // What the slot of an own property has, or the empty value.
    ALWAYS_INLINE JSValue getDirect(PropertyOffset offset) const { return locationForOffset(offset)->get(); }
    JSValue getDirect(VM& vm, PropertyName name, unsigned& attributes) const
    {
        PropertyOffset offset = structure()->get(vm, name, attributes);
        return isValidOffset(offset) ? getDirect(offset) : JSValue();
    }
    JSValue getDirect(VM& vm, PropertyName name) const
    {
        unsigned attributes;
        return getDirect(vm, name, attributes);
    }
    PropertyOffset getDirectOffset(VM& vm, PropertyName name) { return structure()->get(vm, name); }
    PropertyOffset getDirectOffset(VM& vm, PropertyName name, unsigned& attributes) { return structure()->get(vm, name, attributes); }

    ALWAYS_INLINE void putDirectOffset(VM& vm, PropertyOffset offset, JSValue value) { locationForOffset(offset)->set(vm, this, value); }
    bool putDirect(VM& vm, PropertyName name, JSValue value, unsigned attributes = 0)
    {
        Engine::object_put_direct(this, vm, name, value, attributes);
        return canHaveProperties();
    }
    bool putDirect(VM& vm, PropertyName name, JSValue value, unsigned attributes, PutPropertySlot& slot)
    {
        Engine::object_put_direct_with_slot(this, vm, name, value, attributes, slot);
        return canHaveProperties();
    }
    bool putDirectMayBeIndex(JSGlobalObject* globalObject, PropertyName name, JSValue value)
    {
        if (auto index = parseIndex(name)) [[unlikely]]
            return putDirectIndex(globalObject, *index, value);
        return putDirect(getVM(globalObject), name, value);
    }
    bool putDirectAccessor(JSGlobalObject* globalObject, PropertyName name, GetterSetter* accessor, unsigned attributes)
    {
        if (auto index = parseIndex(name)) [[unlikely]]
            return putDirectIndex(globalObject, *index, accessor, attributes, PutDirectIndexLikePutDirect);
        return putDirect(getVM(globalObject), name, accessor, attributes);
    }
    bool putDirectNonIndexAccessor(VM& vm, PropertyName name, GetterSetter* accessor, unsigned attributes) { return putDirect(vm, name, accessor, attributes); }
    bool putDirectCustomAccessor(VM& vm, PropertyName name, JSValue accessor, unsigned attributes) { return putDirect(vm, name, accessor, attributes); }
    bool putDirectNativeFunction(VM&, JSGlobalObject* globalObject, const PropertyName& name, unsigned length, NativeFunction function, ImplementationVisibility visibility, Intrinsic intrinsic, unsigned attributes)
    {
        Engine::object_put_direct_native_function(this, globalObject, name, length, function, visibility, intrinsic, attributes);
        return canHaveProperties();
    }
    bool putDirectNativeIntrinsicGetter(VM&, JSGlobalObject* globalObject, Identifier name, NativeFunction function, Intrinsic intrinsic, unsigned attributes)
    {
        Engine::object_put_direct_native_getter(this, globalObject, name, function, intrinsic, attributes);
        return canHaveProperties();
    }
    JSFunction* putDirectBuiltinFunction(VM&, JSGlobalObject*, const PropertyName&, BuiltinCode, unsigned attributes);

    // For an object that has its structure to itself, such as a new prototype.
    void putDirectWithoutTransition(VM& vm, PropertyName name, JSValue value, unsigned attributes = 0) { Engine::object_put_direct_without_transition(this, vm, name, value, attributes); }
    void putDirectCustomGetterSetterWithoutTransition(VM& vm, PropertyName name, JSValue accessor, unsigned attributes) { putDirectWithoutTransition(vm, name, accessor, attributes); }
    void putDirectNativeFunctionWithoutTransition(VM&, JSGlobalObject*, const PropertyName&, unsigned length, NativeFunction, ImplementationVisibility, Intrinsic, unsigned attributes);
    JSFunction* putDirectBuiltinFunctionWithoutTransition(VM&, JSGlobalObject*, const PropertyName&, BuiltinCode, unsigned attributes);

    unsigned getArrayLength() const { return elementKind() ? m_butterfly->publicLength() : 0; }
    unsigned getVectorLength() const { return elementKind() ? m_butterfly->vectorLength() : 0; }
    // Empty unless the object has the element and reading it runs no code.
    ALWAYS_INLINE JSValue tryGetIndexQuickly(uint64_t index) const
    {
        if (JSValue value = tryGetDense(index))
            return value;
        if (isTypedArrayType(type()) || elementKind() == ArrayStorageShape)
            return Engine::object_try_get_index_quickly(this, index);
        return {};
    }
    ALWAYS_INLINE JSValue tryGetIndexQuickly(unsigned index) const { return tryGetIndexQuickly(static_cast<uint64_t>(index)); }
    bool canGetIndexQuickly(unsigned index) const { return !!tryGetIndexQuickly(index); }
    bool canGetIndexQuickly(uint64_t index) const { return !!tryGetIndexQuickly(index); }
    JSValue getIndexQuickly(unsigned index) const { return tryGetIndexQuickly(index); }
    // Empty if it is no own property.
    JSValue getDirectIndex(JSGlobalObject* globalObject, unsigned index)
    {
        if (JSValue value = tryGetDense(index))
            return value;
        return Engine::object_get_own_index(this, globalObject, index, ENGINE_THROWS_ONLY_IF(ownLookupCanThrow() || elementKind() == ArrayStorageShape));
    }
    ALWAYS_INLINE void setIndexQuickly(VM& vm, unsigned index, JSValue value)
    {
        if (!trySetContiguous(vm, index, value)) [[unlikely]]
            Engine::object_store_element(this, vm, index, value);
    }
    ALWAYS_INLINE void initializeIndex(ObjectInitializationScope& scope, unsigned index, JSValue value) { setIndexQuickly(scope.vm(), index, value); }
    // The elements can represent the value. The type is that of the object, for a caller that has it as a constant.
    ALWAYS_INLINE void initializeIndexWithoutBarrier(ObjectInitializationScope&, unsigned index, JSValue value, IndexingType type = NonArray)
    {
        ASSERT(index < getArrayLength());
        if (!hasContiguous(type) && elementKind() == DoubleShape) {
            RELEASE_ASSERT(value.isNumber() && !std::isnan(value.asNumber()));
            m_butterfly->contiguousDouble().at(this, index) = value.asNumber();
            return;
        }
        RELEASE_ASSERT(hasContiguous(type) || elementKind() == ContiguousShape || (elementKind() == Int32Shape && value.isInt32()));
        ASSERT(!hasContiguous(type) || elementKind() == ContiguousShape);
        m_butterfly->contiguous().at(this, index).setWithoutWriteBarrier(value);
    }
    bool putByIndexInline(JSGlobalObject* globalObject, unsigned index, JSValue value, bool shouldThrow)
    {
        if (trySetContiguous(getVM(globalObject), index, value))
            return true;
        return Engine::object_set_index(this, globalObject, index, value, shouldThrow, ENGINE_THROWS_ONLY_IF(!hasRoomForElement(index)));
    }
    ALWAYS_INLINE bool putDirectIndex(JSGlobalObject* globalObject, unsigned index, JSValue value)
    {
        if (trySetContiguous(getVM(globalObject), index, value))
            return true;
        return putDirectIndex(globalObject, index, value, 0, PutDirectIndexLikePutDirect);
    }
    bool putDirectIndex(JSGlobalObject* globalObject, unsigned index, JSValue value, unsigned attributes, PutDirectIndexMode mode) { return Engine::object_put_direct_index(this, globalObject, index, value, attributes, mode, ENGINE_THROWS_ONLY_IF(attributes || !hasRoomForElement(index))); }

protected:
    ALWAYS_INLINE JSObject(VM& vm, Structure* structure, Butterfly* butterfly = nullptr)
        : JSCell(vm, structure)
        , m_butterfly(butterfly)
    {
        ASSERT(butterfly || !structure->outOfLineCapacity());
    }

private:
    static void checkLayout();

    ALWAYS_INLINE JSValue tryGetDense(uint64_t index) const
    {
        switch (elementKind()) {
        case Int32Shape:
        case ContiguousShape:
            return index < m_butterfly->publicLength() ? m_butterfly->contiguous().at(this, index).get() : JSValue();
        case DoubleShape:
            if (index < m_butterfly->publicLength()) {
                if (double number = m_butterfly->contiguousDouble().at(this, index); number == number)
                    return jsDoubleNumber(number);
            }
            return {};
        default:
            return {};
        }
    }

    ALWAYS_INLINE bool trySetContiguous(VM& vm, unsigned index, JSValue value)
    {
        if (elementKindAndWritability() != ContiguousShape || index >= m_butterfly->vectorLength())
            return false;
        m_butterfly->contiguous().at(this, index).set(vm, this, value);
        if (index >= m_butterfly->publicLength())
            m_butterfly->setPublicLength(index + 1);
        return true;
    }

    bool hasRoomForElement(unsigned index) const { return elementKindAndWritability() < ArrayStorageShape && index < getVectorLength(); }
    // Of what the engine implements.
    bool ownLookupCanThrow() const
    {
        switch (type()) {
        case DerivedStringObjectType:
        case ErrorInstanceType:
        case JSFunctionType:
        case ModuleNamespaceObjectType:
        case ProxyObjectType:
        case StringObjectType:
        case WebAssemblyGCObjectType:
            return true;
        default:
            return false;
        }
    }
    bool hasOrdinaryChain() const
    {
        for (auto* object = this; object; object = object->structure()->storedPrototypeObject()) {
            if (TypeInfo::overridesGetOwnPropertySlot(object->inlineTypeFlags()))
                return false;
        }
        return true;
    }

    Butterfly* m_butterfly;
};
ENGINE_CLASS_HAS_TYPES(JSObject, ObjectType, MaxJSType);

inline void JSObject::checkLayout()
{
    ENGINE_CHECK_SIZE(JSObject, sizeOfJsObject);
    ENGINE_CHECK_OFFSET(JSObject, m_butterfly, JsObject_storage);
}

ALWAYS_INLINE JSObject* asObject(JSCell* cell)
{
    ASSERT(cell->isObject());
    return static_cast<JSObject*>(cell);
}
ALWAYS_INLINE JSObject* asObject(JSValue value) { return asObject(value.asCell()); }

inline JSValue JSCell::fastGetOwnProperty(VM& vm, Structure& structure, PropertyName name)
{
    PropertyOffset offset = structure.get(vm, name);
    return isValidOffset(offset) ? asObject(this)->getDirect(offset) : JSValue();
}

// The base of objects that have a class of their own.
class JSNonFinalObject : public JSObject {
public:
    using Base = JSObject;

    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype) { return Structure::create(vm, globalObject, prototype, TypeInfo(ObjectType, StructureFlags), info()); }

protected:
    ALWAYS_INLINE explicit JSNonFinalObject(VM& vm, Structure* structure, Butterfly* butterfly = nullptr)
        : JSObject(vm, structure, butterfly)
    {
    }
};

// The base of objects that own something outside the heap.
class JSDestructibleObject : public JSNonFinalObject {
public:
    using Base = JSNonFinalObject;

    static constexpr DestructionMode needsDestruction = NeedsDestruction;

    // Also once the structure is gone.
    const ClassInfo* classInfo() const { return m_classInfo; }

protected:
    ALWAYS_INLINE JSDestructibleObject(VM& vm, Structure* structure, Butterfly* butterfly = nullptr)
        : JSNonFinalObject(vm, structure, butterfly)
        , m_classInfo(structure->classInfoForCells())
    {
    }

private:
    static void checkLayout();

    const ClassInfo* m_classInfo;
};

inline void JSDestructibleObject::checkLayout()
{
    ENGINE_CHECK_SIZE(JSDestructibleObject, sizeOfJsDestructibleObject);
    ENGINE_CHECK_OFFSET(JSDestructibleObject, m_classInfo, JsDestructibleObject_class);
}

// An ordinary object.
class JSFinalObject final : public JSObject {
public:
    ENGINE_DECLARE_CLASS(FinalObject)

    static constexpr unsigned defaultInlineCapacity = Engine::Layout::defaultInlineCapacity;
    static constexpr unsigned maxInlineCapacity = Engine::Layout::maxInlineCapacity;

    static JSFinalObject* create(VM& vm, Structure* structure) { return Engine::final_object_create(vm, structure); }
    static Structure* createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype, unsigned inlineCapacity) { return Structure::create(vm, globalObject, prototype, TypeInfo(FinalObjectType, StructureFlags), info(), NonArray, inlineCapacity); }
};
ENGINE_CLASS_HAS_TYPE(JSFinalObject, FinalObjectType);

// An object with fields that built-ins written in JavaScript can get at.
template<unsigned passedNumberOfInternalFields = 1>
class JSInternalFieldObjectImpl : public JSNonFinalObject {
public:
    using Base = JSNonFinalObject;

    static constexpr unsigned numberOfInternalFields = passedNumberOfInternalFields;

    const WriteBarrier<Unknown>& internalField(unsigned index) const
    {
        ASSERT(index < numberOfInternalFields);
        return m_internalFields[index];
    }
    WriteBarrier<Unknown>& internalField(unsigned index)
    {
        ASSERT(index < numberOfInternalFields);
        return m_internalFields[index];
    }

    static void visitChildren(JSCell* cell, SlotVisitor& visitor)
    {
        Base::visitChildren(cell, visitor);
        visitor.appendValues(static_cast<JSInternalFieldObjectImpl*>(cell)->m_internalFields, numberOfInternalFields);
    }
    static void visitChildren(JSCell* cell, AbstractSlotVisitor& visitor) { visitChildren(cell, static_cast<SlotVisitor&>(visitor)); }

protected:
    JSInternalFieldObjectImpl(VM& vm, Structure* structure)
        : Base(vm, structure)
    {
        ENGINE_CHECK_OFFSET(JSInternalFieldObjectImpl, m_internalFields, internalFields);
    }

    WriteBarrier<Unknown> m_internalFields[numberOfInternalFields] {};
};

class InternalFieldTuple final : public JSInternalFieldObjectImpl<2> {
public:
    ENGINE_DECLARE_CLASS(InternalFieldTuple)

    static InternalFieldTuple* create(VM& vm, Structure* structure, JSValue first = jsUndefined(), JSValue second = jsUndefined()) { return Engine::internal_field_tuple_create(vm, structure, first, second); }

    JSValue getInternalField(unsigned index) const { return internalField(index).get(); }
    void putInternalField(VM& vm, unsigned index, JSValue value) { internalField(index).set(vm, this, value); }
};
ENGINE_CLASS_HAS_TYPE(InternalFieldTuple, InternalFieldTupleType);

inline Identifier makeIdentifier(VM& vm, ASCIILiteral name) { return Identifier::fromString(vm, name); }
inline Identifier makeIdentifier(VM&, const Identifier& name) { return name; }

#define JSC_NATIVE_FUNCTION_WITHOUT_TRANSITION(name, function, attributes, length, visibility) \
    putDirectNativeFunctionWithoutTransition(vm, globalObject, makeIdentifier(vm, (name)), (length), function, (visibility), JSC::NoIntrinsic, (attributes))
#define JSC_NATIVE_GETTER(name, function, attributes) \
    putDirectNativeIntrinsicGetter(vm, globalObject, makeIdentifier(vm, (name)), function, JSC::NoIntrinsic, (attributes) | JSC::PropertyAttribute::Accessor)
#define STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(Derived, Base) \
    static_assert(sizeof(Derived) == sizeof(Base));        \
    static_assert(Derived::destroy == Base::destroy)

inline JSFinalObject* constructEmptyObject(VM& vm, Structure* structure) { return JSFinalObject::create(vm, structure); }
JSFinalObject* constructEmptyObject(JSGlobalObject*);
inline JSFinalObject* constructEmptyObject(JSGlobalObject* globalObject, JSObject* prototype, unsigned inlineCapacity = JSFinalObject::defaultInlineCapacity) { return Engine::final_object_with_prototype(globalObject, prototype, inlineCapacity); }
inline JSObject* constructObjectFromPropertyDescriptor(JSGlobalObject* globalObject, const PropertyDescriptor& descriptor) { return Engine::descriptor_to_object(descriptor, globalObject); }
inline bool toPropertyDescriptor(JSGlobalObject* globalObject, JSValue value, PropertyDescriptor& descriptor) { return Engine::descriptor_from_value(descriptor, globalObject, value); }
inline JSObject* objectConstructorFreeze(JSGlobalObject* globalObject, JSObject* object) { return Engine::object_freeze(object, globalObject); }
inline JSObject* objectConstructorSeal(JSGlobalObject* globalObject, JSObject* object) { return Engine::object_seal(object, globalObject); }
inline uint64_t toLength(JSGlobalObject* globalObject, JSObject* object) { return Engine::object_length_of_array_like(object, globalObject); }
inline bool objectPrototypeHasOwnProperty(JSGlobalObject* globalObject, JSObject* object, PropertyName name) { return Engine::object_has_own_property(object, globalObject, name); }
inline String describeRepresentation(JSValue value) { return Engine::value_describe(value); }
inline JSValue objectValues(VM&, JSGlobalObject* globalObject, JSValue value) { return Engine::object_values(globalObject, value); }
inline JSArray* ownPropertyKeys(JSGlobalObject* globalObject, JSObject* object, PropertyNameMode kinds, DontEnumPropertiesMode mode) { return Engine::object_own_keys(object, globalObject, kinds, mode); }
inline JSString* objectPrototypeToString(JSGlobalObject* globalObject, JSValue value) { return Engine::value_to_tagged_string(value, globalObject); }
// The same, as if there were no `Symbol.toStringTag`.
inline JSString* objectPrototypeToStringWithBuiltinTag(JSGlobalObject* globalObject, JSObject* object) { return Engine::object_builtin_tagged_string(object, globalObject); }

} // namespace JSC
