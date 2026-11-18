#pragma once
#include "root.h"
#include "Bindgen/IDLConvert.h"
#include "Bindgen/JSWrapper.h"
#include <JavaScriptCore/EmbedderListItems.h>
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSSet.h>
#include <wtf/InlineASM.h>

namespace Bun::Bindgen {

// The cell of a `b.interface`. Its type says where the ClassInfo is.
template<unsigned inlineCapacity> class JSInterfaceObject;

template<> class JSInterfaceObject<0> : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static constexpr JSC::JSType cellType = static_cast<JSC::JSType>(WebCore::JSInterfaceType);
    static constexpr unsigned inlineCapacity = 0;
    const JSC::ClassInfo* interfaceInfo() const { return classInfo(); }
    DECLARE_VISIT_CHILDREN;
    static void analyzeHeap(JSC::JSCell*, JSC::HeapAnalyzer&);
    DECLARE_DEFAULT_FINISH_CREATION;

protected:
    JSInterfaceObject(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }
};

template<> class JSInterfaceObject<2> : public JSC::JSObjectWithButterfly {
public:
    using Base = JSC::JSObjectWithButterfly;
    static constexpr JSC::DestructionMode needsDestruction = JSC::NeedsDestruction;
    static constexpr JSC::JSType cellType = static_cast<JSC::JSType>(WebCore::JSInterfaceWithInlineStorageType);
    static constexpr unsigned inlineCapacity = 2;
    const JSC::ClassInfo* interfaceInfo() const { return m_classInfo; }
    DECLARE_INFO;
    DECLARE_VISIT_CHILDREN;
    static void analyzeHeap(JSC::JSCell*, JSC::HeapAnalyzer&);
    DECLARE_DEFAULT_FINISH_CREATION;

protected:
    JSInterfaceObject(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
        , m_classInfo(structure->classInfoForCells())
    {
    }

private:
    JSC::WriteBarrier<JSC::Unknown> m_inlineStorage[inlineCapacity];
    const JSC::ClassInfo* m_classInfo;
};

class JSInterfaceList : public JSInterfaceObject<0> {
public:
    using Base = JSInterfaceObject<0>;
    static constexpr JSC::JSType cellType = JSC::EmbedderListType;
    DECLARE_VISIT_CHILDREN;

protected:
    JSInterfaceList(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

private:
    JSC::EmbedderListItems m_items;
};

struct alignas(256) InterfaceInfo {
    JSC::ClassInfo info;
};
static_assert(sizeof(InterfaceInfo) == 256, "src/jsc/bindgen/interface.rs has this too");

// The internal fields of an interface or, if it has none, of the nearest up the chain that has.
struct InterfaceFields {
    uint16_t offset;
    uint16_t count;
    // The number of the next up the chain that has any, or -1.
    int16_t next;
    uint16_t names;
};

// The ClassInfos of an interface and of those that extend it are the `span` elements of an array from its own.
template<typename To, unsigned span>
struct InterfaceInheritsTraits {
    static constexpr std::optional<JSC::JSTypeRange> typeRange { std::nullopt };
    template<typename From>
    static ALWAYS_INLINE bool inherits(From* from)
    {
        if (from->type() != To::cellType)
            return false;
        auto* info = static_cast<const JSInterfaceObject<To::inlineCapacity>*>(static_cast<const JSC::JSCell*>(from))->interfaceInfo();
        return reinterpret_cast<uintptr_t>(info) - reinterpret_cast<uintptr_t>(To::info()) < span * sizeof(InterfaceInfo);
    }
};

template<typename T>
concept InterfaceCell = requires { T::interfaceNumber; };
template<InterfaceCell T> struct ExternTraits<T*> {
    using ExternType = JSC::JSCell*;
    static ExternType convertToExtern(T* object) { return object; }
};

JSC::LazyClassStructure* createInterfaces(Zig::GlobalObject*);
ALWAYS_INLINE JSC::LazyClassStructure& lazyInterface(Zig::GlobalObject* globalObject, unsigned number)
{
    auto* interfaces = globalObject->m_bindgenAdditions.m_interfaces;
    if (!interfaces) [[unlikely]]
        interfaces = createInterfaces(globalObject);
    return interfaces[number];
}
inline JSC::Structure* structureForInterfaceConcurrently(Zig::GlobalObject* globalObject, unsigned number)
{
    auto* interfaces = globalObject->m_bindgenAdditions.m_interfaces;
    return interfaces ? interfaces[number].getConcurrently() : nullptr;
}
JSC::Structure* structureForInterface(JSC::JSGlobalObject*, unsigned number);
JSC::JSObject* prototypeForInterface(JSC::JSGlobalObject*, unsigned number);
JSC::JSObject* constructorForInterface(JSC::JSGlobalObject*, unsigned number);
template<InterfaceCell T> JSC::Structure* structureForClass(JSC::JSGlobalObject* globalObject) { return structureForInterface(globalObject, T::interfaceNumber); }
template<InterfaceCell T> JSC::JSObject* prototypeForClass(JSC::JSGlobalObject* globalObject) { return prototypeForInterface(globalObject, T::interfaceNumber); }
template<InterfaceCell T> JSC::JSObject* constructorForClass(JSC::JSGlobalObject* globalObject) { return constructorForInterface(globalObject, T::interfaceNumber); }
// May throw.
JSC::Structure* interfaceStructureForNewTarget(JSC::JSGlobalObject*, JSC::JSValue newTarget, unsigned number);

// Interfaces whose cells have one size share a subspace.
constexpr unsigned interfaceSubspaceIndex(size_t cellSize, bool needsDestruction, bool hasInlineStorage)
{
    unsigned kind = needsDestruction ? 1 + hasInlineStorage : 0;
    return kind * WebCore::numberOfInterfaceCellSizes + (cellSize - 1) / JSC::MarkedBlock::atomSize;
}
JSC::GCClient::IsoSubspace* createSubspaceForInterface(JSC::VM&, unsigned index);

ALWAYS_INLINE JSC::JSCell* allocateInterfaceCell(JSC::VM& vm, [[maybe_unused]] const JSC::ClassInfo* info, size_t cellSize, bool needsDestruction, bool hasInlineStorage)
{
    unsigned index = interfaceSubspaceIndex(cellSize, needsDestruction, hasInlineStorage);
    auto* space = static_cast<WebCore::JSVMClientData*>(vm.clientData)->clientSubspaces().m_clientSubspaceForInterface[index];
    if (!space) [[unlikely]]
        space = createSubspaceForInterface(vm, index);
    auto* cell = static_cast<JSC::JSCell*>(space->allocate(vm, roundUpToMultipleOf<JSC::MarkedBlock::atomSize>(cellSize), nullptr, JSC::AllocationFailureMode::Assert));
#if ENABLE(GC_VALIDATION)
    ASSERT(!vm.isInitializingObject());
    vm.setInitializingObjectClass(info);
#endif
    cell->clearStructure();
    return cell;
}

JSC::JSObject* createInterfaceObjectOutOfLine(Zig::GlobalObject*, unsigned number, JSC::Structure*, size_t cellSize, bool needsDestruction);

// Null unless a cell is at hand.
template<typename T>
ALWAYS_INLINE T* tryCreateInterfaceObject(Zig::GlobalObject* globalObject, JSC::Structure* structure, size_t cellSize, bool needsDestruction)
{
    auto& vm = JSC::getVM(globalObject);
    auto* space = static_cast<WebCore::JSVMClientData*>(vm.clientData)->clientSubspaces().m_clientSubspaceForInterface[interfaceSubspaceIndex(cellSize, needsDestruction, T::inlineCapacity)];
    if (JSC::validateDFGDoesGC || !space) [[unlikely]]
        return nullptr;
    auto* allocator = std::bit_cast<char*>(space->allocatorFor(0, JSC::AllocatorForMode::AllocatorIfExists).localAllocator());
    auto* cell = std::bit_cast<JSC::FreeList*>(allocator + JSC::LocalAllocator::offsetOfFreeList())->allocateWithCellSize([] { return static_cast<JSC::HeapCell*>(nullptr); }, roundUpToMultipleOf<JSC::MarkedBlock::atomSize>(cellSize));
    if (!cell) [[unlikely]]
        return nullptr;
#if ENABLE(GC_VALIDATION)
    vm.setInitializingObjectClass(T::info());
#endif
    auto* object = new (NotNull, cell) T(vm, structure);
    object->finishCreation(vm);
    return object;
}

enum class PrototypeBase : uint8_t {
    Object,
    Error,
    DOMException,
    EventEmitter,
    Iterator,
    WritableStream,
    AsyncIterator,
    AbortController,
    AbortSignal,
    EventTarget,
    Readable,
    Writable,
};

// The first byte of a row. The `length` of a function without a signature follows, then the name and a zero. A zero ends a table.
namespace MemberRow {
enum : uint8_t {
    Function = 1,
    Builtin,
    Constant,
    Accessor,
    DOMJITAccessor,
    DOMJITFunction,
    KindMask = 7,
    DontEnum = 1 << 3,
    DontDelete = 1 << 4,
    ReadOnly = 1 << 5,
    DOMAttribute = 1 << 6,
};
}

// One for each row, and another for a setter or a signature.
union MemberEntry {
    constexpr MemberEntry(JSC::NativeFunction::Ptr function)
        : function(function)
    {
    }
    constexpr MemberEntry(JSC::BuiltinGenerator generator)
        : generator(generator)
    {
    }
    constexpr MemberEntry(long long constant)
        : constant(constant)
    {
    }
    constexpr MemberEntry(JSC::GetValueFunc::Ptr getter)
        : getter(getter)
    {
    }
    constexpr MemberEntry(JSC::PutValueFunc::Ptr setter)
        : setter(setter)
    {
    }
    constexpr MemberEntry(const JSC::DOMJIT::GetterSetter* domJIT)
        : domJIT(domJIT)
    {
    }
    constexpr MemberEntry(const JSC::DOMJIT::Signature* signature)
        : signature(signature)
    {
    }

    JSC::NativeFunction::Ptr function;
    JSC::BuiltinGenerator generator;
    long long constant;
    JSC::GetValueFunc::Ptr getter;
    JSC::PutValueFunc::Ptr setter;
    const JSC::DOMJIT::GetterSetter* domJIT;
    const JSC::DOMJIT::Signature* signature;
};

struct Condition {
    uint8_t exposure;
    bool isStatic;
};

enum class ArrayFunctions : uint8_t {
    None,
    Iterator,
    All,
};

struct InterfaceDescription {
    // What InterfaceText in JSInterface.cpp reads.
    const char* text;
    const MemberEntry* entries;
    const Condition* conditions;
    unsigned structureFlags;
    uint16_t number;
    // -1 for none.
    int16_t base;
    int16_t unforgeablesIndex;
    // Whose unforgeable members are in the inline storage, in order.
    std::array<int16_t, 2> inlineUnforgeables;
    PrototypeBase prototypeBase;
    JSC::JSType cellType;
    uint8_t inlineCapacity;
    uint8_t length;
    uint8_t numberOfConditions;
    bool hasConstructor;
    bool isNamespace;
    bool isCallbackInterface;
    bool hasIndexedProperties;
    bool isAboveGlobalObject;
    ArrayFunctions arrayFunctions;
};
using FinishPrototype = void (*)(JSC::VM&, JSC::JSGlobalObject*, JSC::JSObject* prototype);
void setupInterface(JSC::LazyClassStructure::Initializer&, const InterfaceDescription&, JSC::NativeFunction call, JSC::NativeFunction construct, FinishPrototype = nullptr);
void putPrivateAttribute(JSC::VM&, JSC::JSObject*, JSC::PropertyName, const JSC::ClassInfo* receiver, JSC::GetValueFunc, JSC::PutValueFunc);
void putAttributesByName(JSC::VM&, JSC::JSObject*, const JSC::ClassInfo* receiver, void(SYSV_ABI* names)(WTF::Vector<WTF::AtomString>*), JSC::GetValueFunc, JSC::PutValueFunc);
JSC::EncodedJSValue constructWithFactory(JSC::JSGlobalObject*, JSC::CallFrame*, JSC::NativeFunction);
void defineUnforgeables(JSC::JSObject*, unsigned unforgeablesIndex);
// The structure of the interface has them from the start. That of a JavaScript class that extends it has none.
ALWAYS_INLINE void defineInlineUnforgeables(JSC::JSObject* object, bool structureHasThem, unsigned unforgeablesIndex, unsigned firstSlot, unsigned endSlot)
{
    if (!structureHasThem) [[unlikely]]
        return defineUnforgeables(object, unforgeablesIndex);
    auto* values = uncheckedDowncast<Zig::GlobalObject>(object->globalObject())->m_bindgenAdditions.m_inlineUnforgeables[unforgeablesIndex];
    for (unsigned slot = firstSlot; slot < endSlot; ++slot)
        object->inlineStorageUnsafe()[slot].setWithoutWriteBarrier(values[slot - firstSlot]);
}

// https://webidl.spec.whatwg.org/#js-legacy-platform-objects. A getter returns the empty value for what is not supported. The others return false if they threw.
struct SpecialOperations {
    JSC::EncodedJSValue(SYSV_ABI* indexedGet)(JSC::JSGlobalObject*, JSC::JSCell*, uint32_t);
    bool (*indexedSet)(JSC::JSGlobalObject*, JSC::JSCell*, uint32_t, JSC::EncodedJSValue);
    uint32_t(SYSV_ABI* indexedLength)(JSC::JSCell*);
    JSC::EncodedJSValue(SYSV_ABI* namedGet)(JSC::JSGlobalObject*, JSC::JSCell*, WTF::StringImpl*);
    bool (*namedSet)(JSC::JSGlobalObject*, JSC::JSCell*, WTF::StringImpl*, JSC::EncodedJSValue);
    bool(SYSV_ABI* namedDelete)(JSC::JSGlobalObject*, JSC::JSCell*, WTF::StringImpl*);
    bool(SYSV_ABI* namedKeys)(JSC::JSGlobalObject*, JSC::JSCell*, WTF::Vector<WTF::AtomString>*);
    bool overridesBuiltIns;
    bool namesAreUnenumerable;

    bool getOwnPropertySlot(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::PropertySlot&) const;
    bool getOwnPropertySlotByIndex(JSC::JSObject*, JSC::JSGlobalObject*, unsigned, JSC::PropertySlot&) const;
    void getOwnPropertyNames(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyNameArrayBuilder&, JSC::DontEnumPropertiesMode) const;
    bool put(JSC::JSCell*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::JSValue, JSC::PutPropertySlot&) const;
    bool putByIndex(JSC::JSCell*, JSC::JSGlobalObject*, unsigned, JSC::JSValue, bool shouldThrow) const;
    bool defineOwnProperty(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName, const JSC::PropertyDescriptor&, bool shouldThrow) const;
    bool deleteProperty(JSC::JSCell*, JSC::JSGlobalObject*, JSC::PropertyName, JSC::DeletePropertySlot&) const;
    bool deletePropertyByIndex(JSC::JSCell*, JSC::JSGlobalObject*, unsigned) const;

private:
    bool isNameHidden(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName) const;
    JSC::JSValue visibleNamedProperty(JSC::JSObject*, JSC::JSGlobalObject*, JSC::PropertyName) const;
};

#define FOR_EACH_SPECIAL_METHOD(macro, ...)                                                                                                                                                   \
    macro(bool, getOwnPropertySlot, (JSC::JSObject * a, JSC::JSGlobalObject * b, JSC::PropertyName c, JSC::PropertySlot & d), (a, b, c, d), __VA_ARGS__)                                      \
        macro(bool, getOwnPropertySlotByIndex, (JSC::JSObject * a, JSC::JSGlobalObject * b, unsigned c, JSC::PropertySlot& d), (a, b, c, d), __VA_ARGS__)                                     \
            macro(void, getOwnPropertyNames, (JSC::JSObject * a, JSC::JSGlobalObject * b, JSC::PropertyNameArrayBuilder & c, JSC::DontEnumPropertiesMode d), (a, b, c, d), __VA_ARGS__)       \
                macro(bool, putByIndex, (JSC::JSCell * a, JSC::JSGlobalObject * b, unsigned c, JSC::JSValue d, bool e), (a, b, c, d, e), __VA_ARGS__)                                         \
                    macro(bool, defineOwnProperty, (JSC::JSObject * a, JSC::JSGlobalObject * b, JSC::PropertyName c, const JSC::PropertyDescriptor& d, bool e), (a, b, c, d, e), __VA_ARGS__) \
                        macro(bool, deleteProperty, (JSC::JSCell * a, JSC::JSGlobalObject * b, JSC::PropertyName c, JSC::DeletePropertySlot & d), (a, b, c, d), __VA_ARGS__)                  \
                            macro(bool, deletePropertyByIndex, (JSC::JSCell * a, JSC::JSGlobalObject * b, unsigned c), (a, b, c), __VA_ARGS__)
#define PUT_METHOD(macro, ...) \
    macro(bool, put, (JSC::JSCell * a, JSC::JSGlobalObject * b, JSC::PropertyName c, JSC::JSValue d, JSC::PutPropertySlot & e), (a, b, c, d, e), __VA_ARGS__)
#define DECLARE_SPECIAL_METHOD(result, name, parameters, arguments, ...) static result name parameters;
#define DEFINE_SPECIAL_METHOD(result, name, parameters, arguments, Class, operations) \
    result Class::name parameters { return operations.name arguments; }
#define DECLARE_LEGACY_PLATFORM_OBJECT                                                    \
    FOR_EACH_SPECIAL_METHOD(DECLARE_SPECIAL_METHOD)                                       \
    static bool preventExtensions(JSC::JSObject*, JSC::JSGlobalObject*) { return false; } \
    static_assert(true)
#define DEFINE_LEGACY_PLATFORM_OBJECT(Class, operations) FOR_EACH_SPECIAL_METHOD(DEFINE_SPECIAL_METHOD, Class, operations)

struct JSONAttribute {
    WTF::ASCIILiteral name;
    JSC::GetValueFunc::Ptr get;
};
JSC::EncodedJSValue defaultToJSON(JSC::JSGlobalObject*, JSC::JSObject*, std::span<const JSONAttribute>);

template<typename Entries> Entries* backing(JSC::JSObject* owner, JSC::WriteBarrier<JSC::Unknown>&);

// The members of what is maplike or setlike.
namespace Collection {
template<typename Entries> JSC::EncodedJSValue entries(JSC::JSGlobalObject*, JSC::CallFrame*, Entries*);
template<typename Entries> JSC::EncodedJSValue values(JSC::JSGlobalObject*, JSC::CallFrame*, Entries*);
template<typename Entries> JSC::EncodedJSValue forEach(JSC::JSGlobalObject*, JSC::CallFrame*, Entries*);
template<typename Entries> JSC::EncodedJSValue has(JSC::JSGlobalObject*, JSC::CallFrame*, Entries*, ConvertElement);
template<typename Entries> JSC::EncodedJSValue remove(JSC::JSGlobalObject*, JSC::CallFrame*, Entries*, ConvertElement);
template<typename Entries> JSC::EncodedJSValue clear(JSC::JSGlobalObject*, JSC::CallFrame*, Entries*);
JSC::EncodedJSValue keys(JSC::JSGlobalObject*, JSC::CallFrame*, JSC::JSMap*);
JSC::EncodedJSValue get(JSC::JSGlobalObject*, JSC::CallFrame*, JSC::JSMap*, ConvertElement);
JSC::EncodedJSValue set(JSC::JSGlobalObject*, JSC::CallFrame*, JSC::JSMap*, ConvertElement key, ConvertElement value);
JSC::EncodedJSValue add(JSC::JSGlobalObject*, JSC::CallFrame*, JSC::JSSet*, ConvertElement);
}

struct NamedInterfaceObject {
    ASCIILiteral name;
    unsigned number;
    JSC::JSValue (*createFactory)(JSC::VM&, JSC::JSObject*);
};

// What a global object has under `name`. A legacy factory function is made anew.
JSC::JSValue interfaceObjectNamed(JSC::JSGlobalObject*, const WTF::StringImpl& name);

struct SerializableInterface {
    unsigned number;
    JSC::EncodedJSValue(SYSV_ABI* serialize)(JSC::JSGlobalObject*, JSC::JSCell*, bool isForStorage);
    JSC::EncodedJSValue(SYSV_ABI* deserialize)(JSC::JSGlobalObject*, JSC::EncodedJSValue);
};
// The plain object that is cloned in its place. Null if it is no instance of a `serializable` interface, or if it threw.
JSC::JSObject* serializeInterface(JSC::JSGlobalObject*, JSC::JSObject*, bool isForStorage);
// Empty if `serializeInterface` did not make what was cloned, or if it threw.
bool isSerializableInterface(JSC::JSObject*);
JSC::JSValue deserializeInterface(JSC::JSGlobalObject*, JSC::JSObject* clone);

JSC_DECLARE_HOST_FUNCTION(callInterfaceObject);
JSC_DECLARE_HOST_FUNCTION(constructInterfaceObject);

// What stands behind the global object that `thisValue` is, or that `undefined` and `null` mean. Else `undefined`.
JSC::JSValue receiverOfGlobal(JSC::JSGlobalObject*, JSC::JSValue thisValue);
template<typename T>
ALWAYS_INLINE T* receiverOrGlobalAs(JSC::JSGlobalObject* globalObject, JSC::JSValue thisValue)
{
    if (auto* object = dynamicDowncast<T>(thisValue))
        return object;
    return dynamicDowncast<T>(receiverOfGlobal(globalObject, thisValue));
}

// Of a stream whose prototype is that of an interface. Else `undefined`.
JSC::JSValue behindInstance(JSC::JSGlobalObject*, JSC::JSValue);

JSC::EncodedJSValue throwIllegalInvocation(JSC::JSGlobalObject*);
JSC::EncodedJSValue rejectIllegalInvocation(JSC::JSGlobalObject*);
JSC::EncodedJSValue rejectIfThrown(JSC::JSGlobalObject*, JSC::EncodedJSValue result);
JSC::EncodedJSValue throwTooFewArguments(JSC::JSGlobalObject*, JSC::CallFrame*, unsigned required);
JSC::EncodedJSValue throwNoOverloadTakes(JSC::JSGlobalObject*, JSC::CallFrame*);
bool putForwards(JSC::JSGlobalObject*, JSC::EncodedJSValue thisValue, JSC::PropertyName, WTF::ASCIILiteral forwardedName, JSC::EncodedJSValue);
bool replaceAttribute(JSC::JSGlobalObject*, JSC::EncodedJSValue thisValue, JSC::PropertyName, JSC::EncodedJSValue);

}

template<typename T>
    requires(Bun::Bindgen::InterfaceCell<T> || std::is_same_v<T, JSC::JSObject>)
struct Bun::IDLHumanReadableName<Bun::Bindgen::IDLRawInterface<T>> : Bun::BaseIDLHumanReadableName {
    static constexpr auto humanReadableName = std::to_array("platform object");
};
