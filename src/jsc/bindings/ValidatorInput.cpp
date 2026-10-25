#include "root.h"

#include "BunValidator.h"
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/ArrayConstructor.h>
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSArrayBufferView.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <JavaScriptCore/StringObject.h>
#include <wtf/text/MakeString.h>

namespace Bun {

using namespace JSC;

namespace {

using Plan = ValidationPlan;
using Shape = Plan::Shape;
using RuleKind = Plan::RuleKind;

// The limits of one call.
constexpr unsigned maxCopiedObjects = 1 << 24;
constexpr unsigned maxHoles = 65536;
constexpr uint64_t maxElementKeys = 1 << 24;
// The longest array there can be.
constexpr uint64_t maxArrayLength = std::numeric_limits<uint32_t>::max();

// The nodes that describe one value, including union arms and the nodes of rules about the same value.
struct NodeSet {
    Vector<uint32_t, 8> nodes;
    bool describesArrays { false };
    bool describesObjects { false };
    // Closed: an object type that rejects undeclared keys. Open: anything else that accepts an object.
    bool hasClosedObject { false };
    bool hasOpenObject { false };
    // A rule reads the value at every depth.
    bool needsDeepCopy { false };
};

// A function is never read: no node that describes an object accepts one.
bool isCopyable(JSValue value)
{
    if (!value.isObject())
        return false;
    JSObject* object = asObject(value);
    JSC::JSType type = object->type();
    return !isFunctionType(type) && !(type == ProxyObjectType && object->isCallable());
}

// A typed array or a String object has a key for each element, and a key takes far more memory than an element.
uint64_t countElementKeys(JSObject* object)
{
    if (isTypedArrayType(object->type()))
        return uncheckedDowncast<JSArrayBufferView>(object)->length();
    if (auto* string = dynamicDowncast<StringObject>(object))
        return string->internalValue()->length();
    return 0;
}

// User code runs between any two steps here. It never sees a copy, and nothing read from a source is kept across a step except values.
class ValueCopier {
public:
    ValueCopier(JSGlobalObject* globalObject, const Plan& plan)
        : m_globalObject(globalObject)
        , m_vm(globalObject->vm())
        , m_plan(plan)
    {
        m_lastSetOfNode.fill(0, plan.nodes.size());
    }

    JSValue copyRoot(JSObject* root)
    {
        NodeSet set;
        startSet();
        add(set, m_plan.root);
        expand(set);
        return copy(root, set, false);
    }

private:
    void startSet() { ++m_currentSet; }

    void add(NodeSet& set, uint32_t index)
    {
        if (index >= m_plan.nodes.size() || m_lastSetOfNode[index] == m_currentSet)
            return;
        m_lastSetOfNode[index] = m_currentSet;
        set.nodes.append(index);
    }

    void addAll(NodeSet& set, const Vector<uint32_t>& indexes)
    {
        for (uint32_t index : indexes)
            add(set, index);
    }

    void expand(NodeSet& set)
    {
        for (unsigned i = 0; i < set.nodes.size(); ++i) {
            const Plan::Node& node = m_plan.nodes[set.nodes[i]];
            switch (node.shape) {
            case Shape::Union:
                addAll(set, node.children);
                break;
            case Shape::Array:
            case Shape::Tuple:
                set.describesArrays = true;
                break;
            case Shape::Dictionary:
                set.describesObjects = true;
                set.hasOpenObject = true;
                break;
            case Shape::Object:
                set.describesObjects = true;
                if (node.undeclared == Plan::Undeclared::Rejected)
                    set.hasClosedObject = true;
                else
                    set.hasOpenObject = true;
                break;
            case Shape::AnyObject:
                set.hasOpenObject = true;
                break;
            case Shape::Unknown:
                set.hasOpenObject |= node.rules.isEmpty();
                break;
            default:
                break;
            }
            for (auto& rule : node.rules) {
                switch (rule.kind) {
                case RuleKind::UniqueItems:
                    set.describesArrays = true;
                    set.needsDeepCopy = true;
                    break;
                case RuleKind::Contains:
                    set.describesArrays = true;
                    set.needsDeepCopy |= rule.maxCount != Plan::none;
                    break;
                case RuleKind::PatternMembers:
                case RuleKind::MemberNames:
                case RuleKind::MinimumMembers:
                case RuleKind::MaximumMembers:
                case RuleKind::DependentMembers:
                    set.describesObjects = true;
                    break;
                case RuleKind::DependentNode:
                    set.describesObjects = true;
                    set.needsDeepCopy = true;
                    addAll(set, rule.nodes);
                    break;
                case RuleKind::Not:
                case RuleKind::If:
                case RuleKind::ExactlyOne:
                    set.needsDeepCopy = true;
                    addAll(set, rule.nodes);
                    break;
                case RuleKind::Every:
                    addAll(set, rule.nodes);
                    break;
                default:
                    break;
                }
            }
        }
    }

    NodeSet findMemberNodes(const NodeSet& objectSet, const Identifier& key)
    {
        NodeSet set;
        startSet();
        for (uint32_t index : objectSet.nodes) {
            const Plan::Node& node = m_plan.nodes[index];
            if (node.shape == Shape::Dictionary)
                add(set, node.child);
            else if (node.shape == Shape::Object) {
                bool isDeclared = false;
                for (auto& member : node.members) {
                    if (!equal(member.key.impl(), key.impl()))
                        continue;
                    isDeclared = true;
                    add(set, member.node);
                }
                if (!isDeclared && node.undeclared == Plan::Undeclared::Validated)
                    add(set, node.child);
            }
            // No pattern is run: a node too many only copies more.
            for (auto& rule : node.rules) {
                if (rule.kind == RuleKind::PatternMembers)
                    addAll(set, rule.nodes);
            }
        }
        expand(set);
        return set;
    }

    NodeSet findElementNodes(const NodeSet& arraySet, unsigned position)
    {
        NodeSet set;
        startSet();
        for (uint32_t index : arraySet.nodes) {
            const Plan::Node& node = m_plan.nodes[index];
            if (node.shape == Shape::Array)
                add(set, node.child);
            else if (node.shape == Shape::Tuple)
                add(set, position < node.children.size() ? node.children[position] : node.child);
            for (auto& rule : node.rules) {
                if (rule.kind == RuleKind::Contains)
                    addAll(set, rule.nodes);
            }
        }
        expand(set);
        return set;
    }

    // From this position on, every element has the same nodes.
    unsigned findEndOfTuples(const NodeSet& arraySet) const
    {
        unsigned end = 0;
        for (uint32_t index : arraySet.nodes) {
            const Plan::Node& node = m_plan.nodes[index];
            if (node.shape == Shape::Tuple)
                end = std::max(end, static_cast<unsigned>(node.children.size()));
        }
        return end;
    }

    // Returns `source` itself if the nodes say nothing about it.
    JSValue copy(JSObject* source, const NodeSet& set, bool isDeepCopy)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        isDeepCopy |= set.needsDeepCopy;
        if (!isDeepCopy && !set.describesArrays && !set.describesObjects)
            return source;
        bool isArray = JSC::isArray(m_globalObject, source);
        RETURN_IF_EXCEPTION(scope, {});
        if (!isDeepCopy && !(isArray ? set.describesArrays : set.describesObjects))
            return source;

        if (!m_vm.isSafeToRecurse()) [[unlikely]] {
            throwStackOverflowError(m_globalObject, scope);
            return {};
        }
        if (!m_remainingObjects) [[unlikely]] {
            throwRangeError(m_globalObject, scope, makeString("Too many objects and arrays in value (limit "_s, maxCopiedObjects, ')'));
            return {};
        }
        --m_remainingObjects;
        RELEASE_AND_RETURN(scope, isArray ? copyArray(source, set, isDeepCopy) : copyObject(source, set, isDeepCopy));
    }

    // Reads what `{ ...source }` reads, in the same order, and then copies the members.
    JSValue copyObject(JSObject* source, const NodeSet& set, bool isDeepCopy)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);

        uint64_t elementKeys = countElementKeys(source);
        if (elementKeys > m_remainingElementKeys) [[unlikely]] {
            throwRangeError(m_globalObject, scope, makeString("Too many elements in typed arrays and String objects (limit "_s, maxElementKeys, ')'));
            return {};
        }
        m_remainingElementKeys -= elementKeys;

        PropertyNameArrayBuilder names(m_vm, PropertyNameMode::StringsAndSymbols, PrivateSymbolMode::Exclude);
        source->methodTable()->getOwnPropertyNames(source, m_globalObject, names, DontEnumPropertiesMode::Include);
        RETURN_IF_EXCEPTION(scope, {});

        bool refusesSymbols = set.hasClosedObject && !set.hasOpenObject;
        JSObject* result = constructEmptyObject(m_globalObject);
        Vector<unsigned, 8> positionsOfObjects;
        MarkedArgumentBuffer objects;
        for (unsigned position = 0; position < names.size(); ++position) {
            const Identifier& name = names[position];
            PropertySlot slot(source, PropertySlot::InternalMethodType::GetOwnProperty);
            bool isPresent = source->methodTable()->getOwnPropertySlot(source, m_globalObject, name, slot);
            RETURN_IF_EXCEPTION(scope, {});
            if (!isPresent || (slot.attributes() & PropertyAttribute::DontEnum))
                continue;
            JSValue value = slot.isTaintedByOpaqueObject() ? source->get(m_globalObject, name) : slot.getValue(m_globalObject, name);
            RETURN_IF_EXCEPTION(scope, {});
            if (name.isSymbol()) {
                if (refusesSymbols) {
                    addKeyInPlaceOfSymbol(result, name);
                    RETURN_IF_EXCEPTION(scope, {});
                }
                continue;
            }
            // A native getter may return nothing.
            if (!value) [[unlikely]]
                value = jsUndefined();
            result->putDirectMayBeIndex(m_globalObject, name, value);
            RETURN_IF_EXCEPTION(scope, {});
            if (isCopyable(value)) {
                positionsOfObjects.append(position);
                objects.append(value);
            }
        }
        if (objects.hasOverflowed()) [[unlikely]] {
            throwOutOfMemoryError(m_globalObject, scope);
            return {};
        }

        for (unsigned i = 0; i < objects.size(); ++i) {
            const Identifier& name = names[positionsOfObjects[i]];
            JSValue member = objects.at(i);
            NodeSet memberSet = findMemberNodes(set, name);
            JSValue memberCopy = copy(asObject(member), memberSet, isDeepCopy);
            RETURN_IF_EXCEPTION(scope, {});
            if (memberCopy == member)
                continue;
            result->putDirectMayBeIndex(m_globalObject, name, memberCopy);
            RETURN_IF_EXCEPTION(scope, {});
        }
        return result;
    }

    // A copy has string keys only. A closed object type refuses a symbol key, so an undeclared string key stands in for it.
    void addKeyInPlaceOfSymbol(JSObject* result, const Identifier& symbol)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        String text = tryMakeString("Symbol("_s, StringView(symbol.impl()), ')');
        if (!text) [[unlikely]] {
            throwOutOfMemoryError(m_globalObject, scope);
            return;
        }
        Identifier key = Identifier::fromString(m_vm, text);
        if (!result->getDirect(m_vm, key))
            result->putDirect(m_vm, key, jsUndefined());
    }

    // Reads `length`, then each index in order. The copy has no holes.
    JSValue copyArray(JSObject* source, const NodeSet& set, bool isDeepCopy)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);

        JSValue lengthValue = source->get(m_globalObject, m_vm.propertyNames->length);
        RETURN_IF_EXCEPTION(scope, {});
        uint64_t length = lengthValue.toLength(m_globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (length > maxArrayLength) [[unlikely]] {
            throwRangeError(m_globalObject, scope, makeString("Too many elements in array (limit "_s, maxArrayLength, ')'));
            return {};
        }

        JSArray* result = constructEmptyArray(m_globalObject, nullptr);
        RETURN_IF_EXCEPTION(scope, {});
        unsigned endOfTuples = findEndOfTuples(set);
        NodeSet elementSet;
        bool isSetOfAllTheRest = false;
        for (unsigned i = 0; i < length; ++i) {
            JSValue element = source->getIndex(m_globalObject, i);
            RETURN_IF_EXCEPTION(scope, {});
            if (element.isUndefined()) {
                bool isOwn = source->hasOwnProperty(m_globalObject, i);
                RETURN_IF_EXCEPTION(scope, {});
                if (!isOwn) {
                    if (!m_remainingHoles) [[unlikely]] {
                        throwRangeError(m_globalObject, scope, makeString("Too many holes in arrays (limit "_s, maxHoles, ')'));
                        return {};
                    }
                    --m_remainingHoles;
                }
            } else if (isCopyable(element)) {
                if (!isSetOfAllTheRest) {
                    elementSet = findElementNodes(set, i);
                    isSetOfAllTheRest = i >= endOfTuples;
                }
                element = copy(asObject(element), elementSet, isDeepCopy);
                RETURN_IF_EXCEPTION(scope, {});
            }
            // Never push(): this defines an own element whatever the prototypes hold.
            result->putDirectIndex(m_globalObject, i, element);
            RETURN_IF_EXCEPTION(scope, {});
        }
        return result;
    }

    JSGlobalObject* m_globalObject;
    VM& m_vm;
    const Plan& m_plan;
    // Says in constant time whether a node is already in the set that is being built.
    Vector<uint64_t> m_lastSetOfNode;
    uint64_t m_currentSet { 0 };
    unsigned m_remainingObjects { maxCopiedObjects };
    unsigned m_remainingHoles { maxHoles };
    uint64_t m_remainingElementKeys { maxElementKeys };
};

} // namespace

JSValue copyForValidation(JSGlobalObject* globalObject, const ValidationPlan& plan, JSValue value)
{
    if (!isCopyable(value))
        return value;
    return ValueCopier(globalObject, plan).copyRoot(asObject(value));
}

} // namespace Bun
