// Builds the scope manager's objects for JavaScript lint plugins from the arrays written by src/lint/js_plugin/scopes.rs.
// One call per file.
//
// The objects are what `eslint-scope` or `@typescript-eslint/scope-manager` make: plain objects with own data properties in
// the same order. src/lint/js_plugin/worker/scope.js has the classes and says which property goes where. For each class it
// passes a template object made by `shape`, and a program with one `Field` per property.

#include "root.h"

#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGenericTypedArrayViewInlines.h>
#include <JavaScriptCore/JSMapInlines.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <JavaScriptCore/JSWeakMapInlines.h>
#include <JavaScriptCore/ObjectInitializationScope.h>

namespace Bun {
using namespace JSC;

namespace {

constexpr uint32_t none = UINT32_MAX;

// What goes into a property. scope.js has the same numbers.
enum class Field : uint8_t {
    // The value that the template has.
    Copy,
    // The index in the message, from 1.
    Id,
    // Of a scope.
    Set,
    Taints,
    Block,
    Through,
    Variables,
    References,
    VariableScope,
    Upper,
    IsStrict,
    ThisFound,
    ChildScopes,
    DeclaredVariables,
    Implicit,
    // Of a variable. `References` too.
    Name,
    Identifiers,
    Defs,
    Stack,
    Scope,
    EslintUsed,
    EslintExported,
    EslintImplicitGlobalSetting,
    EslintExplicitGlobal,
    Writeable,
    IsTypeVariable,
    IsValueVariable,
    // Of a definition. `Name` too.
    Node,
    Parent,
    Index,
    Kind,
    Rest,
    // Of a reference.
    Identifier,
    From,
    Resolved,
    Flag,
    WriteExpr,
    Partial,
    Init,
    Count,
};

// The message. src/lint/js_plugin/scopes.rs documents the layout.
struct LintScopes {
    static constexpr size_t headerWords = 11, scopeWords = 9, variableWords = 8, definitionWords = 7, referenceWords = 5;

    uint32_t scopeCount, declaredCount, variableCount, definitionCount, referenceCount, implicitCount;
    uint32_t listed, nodeToScope, declaredVariables;
    std::span<const uint32_t> scopes, variables, definitions, references, implicit, lists;

    auto scope(uint32_t index) const { return scopes.subspan(size_t(index) * scopeWords, scopeWords); }
    auto variable(uint32_t index) const { return variables.subspan(size_t(index) * variableWords, variableWords); }
    auto definition(uint32_t index) const { return definitions.subspan(size_t(index) * definitionWords, definitionWords); }
    auto reference(uint32_t index) const { return references.subspan(size_t(index) * referenceWords, referenceWords); }
    auto list(uint32_t at) const { return lists.subspan(at + 1, lists[at]); }

    bool isList(uint32_t at) const { return at < lists.size() && lists[at] < lists.size() - at; }

    // A list whose items are all below `count`.
    bool isListOf(uint32_t at, uint32_t count) const
    {
        if (!isList(at))
            return false;
        for (uint32_t item : list(at)) {
            if (item >= count)
                return false;
        }
        return true;
    }

    // A list of pairs, a node and a list of items below `count`.
    bool isMapOf(uint32_t at, uint32_t nodeCount, uint32_t count) const
    {
        if (!isList(at) || lists[at] % 2)
            return false;
        auto pairs = list(at);
        for (size_t i = 0; i < pairs.size(); i += 2) {
            if (pairs[i] >= nodeCount || !isListOf(pairs[i + 1], count))
                return false;
        }
        return true;
    }

    static bool isIndexOrNone(uint32_t index, uint32_t count) { return index < count || index == none; }

    // Checks every length and index, so that nothing has to be checked while the objects are built.
    bool read(std::span<const uint8_t> bytes, uint32_t nodeCount, uint32_t nameCount, uint32_t textLength)
    {
        if (bytes.size() < headerWords * 4 || reinterpret_cast<uintptr_t>(bytes.data()) % 4)
            return false;
        std::span<const uint32_t> words { reinterpret_cast<const uint32_t*>(bytes.data()), bytes.size() / 4 };
        scopeCount = words[0];
        declaredCount = words[1];
        variableCount = words[2];
        definitionCount = words[3];
        referenceCount = words[4];
        implicitCount = words[5];
        uint64_t listLength = words[6];
        listed = words[7];
        nodeToScope = words[8];
        declaredVariables = words[9];
        uint64_t at = headerWords;
        bool fits = true;
        auto part = [&](uint64_t length) {
            std::span<const uint32_t> result;
            if (fits && length <= words.size() - at)
                result = words.subspan(at, length);
            else
                fits = false;
            at += fits ? length : 0;
            return result;
        };
        scopes = part(uint64_t(scopeCount) * scopeWords);
        variables = part(uint64_t(variableCount) * variableWords);
        definitions = part(uint64_t(definitionCount) * definitionWords);
        references = part(uint64_t(referenceCount) * referenceWords);
        implicit = part(implicitCount);
        lists = part(listLength);
        if (!fits || !scopeCount || declaredCount > variableCount)
            return false;

        for (uint32_t i = 0; i < scopeCount; ++i) {
            auto it = scope(i);
            if (it[1] >= nodeCount || !isIndexOrNone(it[2], scopeCount) || it[3] >= scopeCount)
                return false;
            if (!isListOf(it[5], scopeCount) || !isListOf(it[6], variableCount) || !isListOf(it[7], referenceCount) || !isListOf(it[8], referenceCount))
                return false;
        }
        for (uint32_t i = 0; i < variableCount; ++i) {
            auto it = variable(i);
            uint32_t name = it[0] >> 2;
            switch (it[0] & 3) {
            case 0:
                if (name >= nodeCount)
                    return false;
                break;
            case 1:
                break;
            case 2:
                if (name >= nameCount)
                    return false;
                break;
            default:
                if (!isListOf(name, textLength + 1) || lists[name] != 2)
                    return false;
            }
            if (it[1] >= scopeCount || !isListOf(it[3], definitionCount) || !isListOf(it[4], referenceCount) || !isListOf(it[5], nodeCount))
                return false;
        }
        for (uint32_t i = 0; i < definitionCount; ++i) {
            auto it = definition(i);
            // One whose name isn't in the tree is in no list.
            if (!isIndexOrNone(it[1], nodeCount) || !isIndexOrNone(it[2], nodeCount) || !isIndexOrNone(it[3], nodeCount))
                return false;
        }
        for (uint32_t i = 0; i < referenceCount; ++i) {
            auto it = reference(i);
            if (it[0] >= nodeCount || !isIndexOrNone(it[2], nodeCount) || !isIndexOrNone(it[3], variableCount) || it[4] >= scopeCount)
                return false;
        }
        for (uint32_t pairs : implicit) {
            if (!isList(pairs) || !lists[pairs] || lists[pairs] % 2)
                return false;
            auto items = list(pairs);
            for (size_t i = 0; i < items.size(); i += 2) {
                if (items[i] >= nodeCount || !isIndexOrNone(items[i + 1], nodeCount))
                    return false;
            }
        }
        return isListOf(listed, scopeCount) && isMapOf(nodeToScope, nodeCount, scopeCount) && isMapOf(declaredVariables, nodeCount, variableCount + implicitCount);
    }
};

// A class of objects: a template with its Structure, and what goes into each property.
struct Shape {
    JSObject* like { nullptr };
    std::span<const uint8_t> program;
};

// In the flags of a variable.
constexpr uint32_t isType = 1, isValue = 2, isUsed = 4, isArguments = 16, isStack = 256;
// In the flags of a reference.
constexpr uint32_t isWrite = 2, isInit = 8, isPartial = 512;
// In the flags of a definition.
constexpr uint32_t isRest = 1, lacksParent = 2;
// In `strings`.
constexpr uint32_t argumentsString = 0, firstSetting = 1, firstKind = 4, stringCount = 9;
// In the group of definitions, after the kinds of the message.
constexpr uint32_t implicitGlobalVariable = 10;

class LintScopeMaker {
public:
    LintScopeMaker(JSGlobalObject* globalObject, const LintScopes& message, JSArray* nodes, JSArray* names, JSArray* strings, JSString* text)
        : m_globalObject(globalObject)
        , m_vm(globalObject->vm())
        , m_message(message)
        , m_nodes(nodes)
        , m_names(names)
        , m_strings(strings)
        , m_text(text)
        , m_arrayStructure(globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithContiguous))
    {
    }

    Vector<Shape, 20> scopeShapes, variableShapes, definitionShapes, referenceShapes;
    Shape implicitShape;
    Structure* mapStructure { nullptr };
    Structure* weakMapStructure { nullptr };
    // For `set` of the global scope.
    Structure* globalSetStructure { nullptr };

    // Whether every object of the message has a shape.
    bool hasShapes() const
    {
        auto has = [](const auto& shapes, uint32_t index) { return index < shapes.size() && shapes[index].like; };
        for (uint32_t i = 0; i < m_message.scopeCount; ++i) {
            if (!has(scopeShapes, m_message.scope(i)[0] & 255))
                return false;
        }
        for (uint32_t i = 0; i < m_message.variableCount; ++i) {
            if (!has(variableShapes, m_message.variable(i)[6] >> 8))
                return false;
        }
        for (uint32_t i = 0; i < m_message.definitionCount; ++i) {
            auto it = m_message.definition(i);
            if (!has(definitionShapes, it[0]) || it[6] >= stringCount - firstKind + 1)
                return false;
        }
        return has(variableShapes, 0) && has(definitionShapes, implicitGlobalVariable) && has(referenceShapes, 0) && has(referenceShapes, 1) && implicitShape.like;
    }

    // `[scopeManager.scopes, scopes, variables, nodeToScope, declaredVariables, definitions, references]`. Empty if an exception
    // was thrown.
    JSValue make()
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        auto& message = m_message;

        // Everything below is reachable from `result` as soon as it exists.
        JSArray* result = emptyArray(7);
        RETURN_IF_EXCEPTION(scope, {});
        auto cells = [&](unsigned at, uint32_t count) {
            JSArray* array = emptyArray(count);
            if (array)
                result->setIndexQuickly(m_vm, at, array);
            return array;
        };
        m_scopes = cells(1, message.scopeCount);
        RETURN_IF_EXCEPTION(scope, {});
        // The implicit globals come after the variables of the message.
        m_variables = cells(2, message.variableCount + message.implicitCount);
        RETURN_IF_EXCEPTION(scope, {});
        m_definitions = cells(5, message.definitionCount);
        RETURN_IF_EXCEPTION(scope, {});
        m_references = cells(6, message.referenceCount);
        RETURN_IF_EXCEPTION(scope, {});
        m_declaredVariables = JSWeakMap::create(m_vm, weakMapStructure);
        result->setIndexQuickly(m_vm, 4, m_declaredVariables);

        // The objects point at each other, so all cells come first.
        auto create = [&](const Shape& shape) { return JSFinalObject::create(m_vm, shape.like->structure()); };
        for (uint32_t i = 0; i < message.scopeCount; ++i)
            m_scopes->setIndexQuickly(m_vm, i, create(scopeShapes[message.scope(i)[0] & 255]));
        for (uint32_t i = 0; i < message.variableCount; ++i)
            m_variables->setIndexQuickly(m_vm, i, create(variableShapes[message.variable(i)[6] >> 8]));
        for (uint32_t i = 0; i < message.implicitCount; ++i)
            m_variables->setIndexQuickly(m_vm, message.variableCount + i, create(variableShapes[0]));
        for (uint32_t i = 0; i < message.definitionCount; ++i)
            m_definitions->setIndexQuickly(m_vm, i, create(definitionShapes[message.definition(i)[0]]));
        for (uint32_t i = 0; i < message.referenceCount; ++i)
            m_references->setIndexQuickly(m_vm, i, create(referenceShapes[message.reference(i)[1] & isWrite ? 1 : 0]));

        for (uint32_t i = 0; i < message.definitionCount; ++i)
            fillDefinition(i);
        for (uint32_t i = 0; i < message.referenceCount; ++i)
            fillReference(i);
        for (uint32_t i = 0; i < message.variableCount; ++i) {
            fillVariable(i);
            RETURN_IF_EXCEPTION(scope, {});
        }
        for (uint32_t i = 0; i < message.implicitCount; ++i) {
            fillImplicitVariable(i);
            RETURN_IF_EXCEPTION(scope, {});
        }
        for (uint32_t i = 0; i < message.scopeCount; ++i) {
            fillScope(i);
            RETURN_IF_EXCEPTION(scope, {});
        }

        fillWeakMap(m_declaredVariables, message.declaredVariables, m_variables);
        RETURN_IF_EXCEPTION(scope, {});
        JSWeakMap* nodeToScope = JSWeakMap::create(m_vm, weakMapStructure);
        result->setIndexQuickly(m_vm, 3, nodeToScope);
        fillWeakMap(nodeToScope, message.nodeToScope, m_scopes);
        RETURN_IF_EXCEPTION(scope, {});
        JSArray* listed = array(message.listed, m_scopes);
        RETURN_IF_EXCEPTION(scope, {});
        result->setIndexQuickly(m_vm, 0, listed);
        return result;
    }

private:
    // An array of `length` holes. Throws if there's no memory.
    JSArray* emptyArray(uint32_t length)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        JSArray* array = JSArray::tryCreate(m_vm, m_arrayStructure, length);
        if (!array) [[unlikely]]
            throwOutOfMemoryError(m_globalObject, scope);
        return array;
    }

    // The items of `from` at the indices `items`. Throws if there's no memory.
    JSArray* array(std::span<const uint32_t> items, JSArray* from)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        ObjectInitializationScope initializationScope(m_vm);
        JSArray* array = JSArray::tryCreateUninitializedRestricted(initializationScope, m_arrayStructure, items.size());
        if (!array) [[unlikely]] {
            throwOutOfMemoryError(m_globalObject, scope);
            return nullptr;
        }
        for (unsigned i = 0; i < items.size(); ++i)
            array->initializeIndex(initializationScope, i, from->getIndexQuickly(items[i]));
        return array;
    }

    JSArray* array(uint32_t list, JSArray* from) { return array(m_message.list(list), from); }

    JSValue nodeOrNull(uint32_t id) { return id == none ? jsNull() : m_nodes->getIndexQuickly(id); }
    JSValue string(uint32_t index) { return m_strings->getIndexQuickly(index); }

    // `node.name`, or `String(node.value)` of a `Literal`. A plugin can have changed the node.
    JSValue nameOfNode(uint32_t id)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        JSObject* node = m_nodes->getIndexQuickly(id).getObject();
        if (!node) [[unlikely]]
            return jsUndefined();
        // Nearly all are `Identifier`s, which have one Structure.
        if (node->structureID() != m_nameStructure) {
            unsigned attributes;
            PropertyOffset offset = node->structure()->get(m_vm, m_vm.propertyNames->name, attributes);
            if (!isValidOffset(offset) || attributes & (PropertyAttribute::Accessor | PropertyAttribute::CustomAccessorOrValue)) [[unlikely]] {
                JSValue value = node->get(m_globalObject, m_vm.propertyNames->value);
                RETURN_IF_EXCEPTION(scope, {});
                JSString* name = value.toString(m_globalObject);
                RETURN_IF_EXCEPTION(scope, {});
                return name;
            }
            m_nameStructure = node->structureID();
            m_nameOffset = offset;
        }
        return node->getDirect(m_nameOffset);
    }

    JSValue nameOf(uint32_t word)
    {
        uint32_t number = word >> 2;
        switch (word & 3) {
        case 0:
            return nameOfNode(number);
        case 1:
            return string(argumentsString);
        case 2:
            return m_names->getIndexQuickly(number);
        default: {
            auto range = m_message.list(number);
            uint32_t start = std::min(range[0], range[1]);
            return jsSubstringOfResolved(m_vm, m_text, start, range[1] - start);
        }
        }
    }

    // A `Map` from the names of `variables` to them.
    JSMap* mapOf(Structure* structure, std::span<const uint32_t> variables)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        JSMap* map = JSMap::create(m_vm, structure);
        for (uint32_t index : variables) {
            JSObject* variable = asObject(m_variables->getIndexQuickly(index));
            map->set(m_globalObject, variable->getDirect(m_variableNameOffset), variable);
            RETURN_IF_EXCEPTION(scope, nullptr);
        }
        return map;
    }

    // `pairs`: a list of nodes, each with a list of indices in `from`.
    void fillWeakMap(JSWeakMap* map, uint32_t pairs, JSArray* from)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        auto items = m_message.list(pairs);
        for (size_t i = 0; i < items.size(); i += 2) {
            JSValue node = m_nodes->getIndexQuickly(items[i]);
            JSArray* list = array(items[i + 1], from);
            RETURN_IF_EXCEPTION(scope, void());
            if (node.isObject()) [[likely]]
                map->set(m_vm, asObject(node), list);
        }
    }

    void fillDefinition(uint32_t index)
    {
        auto it = m_message.definition(index);
        // One whose name isn't in the tree is in no list.
        if (it[1] == none)
            return;
        const Shape& shape = definitionShapes[it[0]];
        JSObject* definition = asObject(m_definitions->getIndexQuickly(index));
        bool hasParent = !(it[5] & lacksParent);
        for (PropertyOffset offset = 0; offset < static_cast<PropertyOffset>(shape.program.size()); ++offset) {
            JSValue value;
            switch (static_cast<Field>(shape.program[offset])) {
            case Field::Id:
                value = jsNumber(index + 1);
                break;
            case Field::Name:
                value = m_nodes->getIndexQuickly(it[1]);
                break;
            case Field::Node:
                value = nodeOrNull(it[2]);
                break;
            case Field::Parent:
                value = hasParent ? nodeOrNull(it[3]) : jsUndefined();
                break;
            case Field::Index:
                value = !hasParent ? jsUndefined() : it[4] == none ? jsNull() : jsNumber(it[4]);
                break;
            case Field::Kind:
                value = !hasParent ? jsUndefined() : it[6] ? string(firstKind + it[6] - 1) : jsNull();
                break;
            case Field::Rest:
                value = jsBoolean(it[5] & isRest);
                break;
            default:
                value = shape.like->getDirect(offset);
            }
            definition->putDirectOffset(m_vm, offset, value);
        }
    }

    void fillReference(uint32_t index)
    {
        auto it = m_message.reference(index);
        bool writes = it[1] & isWrite;
        const Shape& shape = referenceShapes[writes ? 1 : 0];
        JSObject* reference = asObject(m_references->getIndexQuickly(index));
        for (PropertyOffset offset = 0; offset < static_cast<PropertyOffset>(shape.program.size()); ++offset) {
            JSValue value;
            switch (static_cast<Field>(shape.program[offset])) {
            case Field::Id:
                value = jsNumber(index + 1);
                break;
            case Field::Identifier:
                value = m_nodes->getIndexQuickly(it[0]);
                break;
            case Field::From:
                value = m_scopes->getIndexQuickly(it[4]);
                break;
            case Field::Resolved:
                value = it[3] == none ? jsNull() : m_variables->getIndexQuickly(it[3]);
                break;
            case Field::Flag:
                value = jsNumber(it[1] & 3);
                break;
            case Field::WriteExpr:
                value = writes ? nodeOrNull(it[2]) : jsUndefined();
                break;
            case Field::Partial:
                value = jsBoolean(it[1] & isPartial);
                break;
            case Field::Init:
                value = writes ? jsBoolean(it[1] & isInit) : jsUndefined();
                break;
            default:
                value = shape.like->getDirect(offset);
            }
            reference->putDirectOffset(m_vm, offset, value);
        }
    }

    void fillVariable(uint32_t index)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        auto it = m_message.variable(index);
        const Shape& shape = variableShapes[it[6] >> 8];
        JSObject* variable = asObject(m_variables->getIndexQuickly(index));
        uint32_t flags = it[2], settings = it[6];
        for (PropertyOffset offset = 0; offset < static_cast<PropertyOffset>(shape.program.size()); ++offset) {
            JSValue value;
            switch (static_cast<Field>(shape.program[offset])) {
            case Field::Id:
                value = jsNumber(index + 1);
                break;
            case Field::Name:
                value = nameOf(it[0]);
                break;
            case Field::Identifiers:
                value = array(it[5], m_nodes);
                break;
            case Field::References:
                value = array(it[4], m_references);
                break;
            case Field::Defs:
                value = array(it[3], m_definitions);
                break;
            case Field::Stack:
                value = jsBoolean(flags & isStack);
                break;
            case Field::Scope:
                value = m_scopes->getIndexQuickly(it[1]);
                break;
            case Field::EslintUsed:
                value = jsBoolean(flags & isUsed);
                break;
            case Field::EslintExported:
                value = jsBoolean(true);
                break;
            case Field::EslintImplicitGlobalSetting:
                value = (settings & 3) == 3 ? jsUndefined() : string(firstSetting + (settings & 3));
                break;
            case Field::EslintExplicitGlobal:
                value = jsBoolean(settings & 16);
                break;
            case Field::Writeable:
                value = jsBoolean(settings & 4);
                break;
            case Field::IsTypeVariable:
                value = jsBoolean(flags & isType);
                break;
            case Field::IsValueVariable:
                value = jsBoolean(flags & isValue);
                break;
            default:
                value = shape.like->getDirect(offset);
            }
            RETURN_IF_EXCEPTION(scope, void());
            variable->putDirectOffset(m_vm, offset, value);
        }
    }

    // A variable that an assignment in sloppy mode creates. It has a definition for each such assignment.
    void fillImplicitVariable(uint32_t index)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        auto pairs = m_message.list(m_message.implicit[index]);
        const Shape& shape = variableShapes[0];
        const Shape& definitionShape = definitionShapes[implicitGlobalVariable];
        JSObject* variable = asObject(m_variables->getIndexQuickly(m_message.variableCount + index));
        for (PropertyOffset offset = 0; offset < static_cast<PropertyOffset>(shape.program.size()); ++offset) {
            JSValue value;
            switch (static_cast<Field>(shape.program[offset])) {
            case Field::Id:
                value = jsNumber(m_message.variableCount + index + 1);
                break;
            case Field::Name:
                value = nameOfNode(pairs[0]);
                break;
            case Field::References:
                value = emptyArray(0);
                break;
            case Field::Identifiers:
            case Field::Defs:
                value = emptyArray(pairs.size() / 2);
                break;
            case Field::Stack:
                value = jsBoolean(true);
                break;
            case Field::Scope:
                value = m_scopes->getIndexQuickly(0);
                break;
            case Field::EslintUsed:
                value = jsBoolean(false);
                break;
            default:
                value = shape.like->getDirect(offset);
            }
            RETURN_IF_EXCEPTION(scope, void());
            variable->putDirectOffset(m_vm, offset, value);
            // The arrays are reachable now, so they can be filled.
            for (size_t i = 0; i < pairs.size() && static_cast<Field>(shape.program[offset]) == Field::Identifiers; i += 2)
                asArray(value)->setIndexQuickly(m_vm, i / 2, m_nodes->getIndexQuickly(pairs[i]));
            for (size_t i = 0; i < pairs.size() && static_cast<Field>(shape.program[offset]) == Field::Defs; i += 2) {
                JSObject* definition = JSFinalObject::create(m_vm, definitionShape.like->structure());
                asArray(value)->setIndexQuickly(m_vm, i / 2, definition);
                for (PropertyOffset at = 0; at < static_cast<PropertyOffset>(definitionShape.program.size()); ++at) {
                    Field field = static_cast<Field>(definitionShape.program[at]);
                    definition->putDirectOffset(m_vm, at, field == Field::Name ? m_nodes->getIndexQuickly(pairs[i]) : field == Field::Node ? nodeOrNull(pairs[i + 1]) : field == Field::Id ? jsNumber(m_message.definitionCount + i / 2 + 1) : definitionShape.like->getDirect(at));
                }
            }
        }
    }

    void fillScope(uint32_t index)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        auto it = m_message.scope(index);
        const Shape& shape = scopeShapes[it[0] & 255];
        JSObject* cell = asObject(m_scopes->getIndexQuickly(index));
        for (PropertyOffset offset = 0; offset < static_cast<PropertyOffset>(shape.program.size()); ++offset) {
            JSValue value;
            switch (static_cast<Field>(shape.program[offset])) {
            case Field::Id:
                value = jsNumber(index + 1);
                break;
            case Field::Set:
                value = mapOf(index ? mapStructure : globalSetStructure, m_message.list(it[6]));
                break;
            case Field::Taints: {
                JSMap* taints = JSMap::create(m_vm, mapStructure);
                value = taints;
                auto variables = m_message.list(it[6]);
                if (!variables.empty() && m_message.variable(variables[0])[2] & isArguments)
                    taints->set(m_globalObject, string(argumentsString), jsBoolean(true));
                break;
            }
            case Field::Block:
                value = m_nodes->getIndexQuickly(it[1]);
                break;
            case Field::Through:
                value = array(it[8], m_references);
                break;
            case Field::Variables:
                value = array(it[6], m_variables);
                break;
            case Field::References:
                value = array(it[7], m_references);
                break;
            case Field::VariableScope:
                value = m_scopes->getIndexQuickly(it[3]);
                break;
            case Field::Upper:
                value = it[2] == none ? jsNull() : m_scopes->getIndexQuickly(it[2]);
                break;
            case Field::IsStrict:
                value = jsBoolean(it[0] & 256);
                break;
            case Field::ThisFound:
                value = jsBoolean(it[0] & 512);
                break;
            case Field::ChildScopes:
                value = array(it[5], m_scopes);
                break;
            case Field::DeclaredVariables:
                value = m_declaredVariables;
                break;
            case Field::Implicit:
                value = JSFinalObject::create(m_vm, implicitShape.like->structure());
                break;
            default:
                value = shape.like->getDirect(offset);
            }
            RETURN_IF_EXCEPTION(scope, void());
            cell->putDirectOffset(m_vm, offset, value);
            if (static_cast<Field>(shape.program[offset]) == Field::Implicit) {
                fillImplicit(asObject(value), it[8]);
                RETURN_IF_EXCEPTION(scope, void());
            }
        }
    }

    // `globalScope.implicit`. `through`: that of the global scope.
    void fillImplicit(JSObject* implicit, uint32_t through)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        Vector<uint32_t, 8> variables(m_message.implicitCount, [&](size_t i) { return m_message.variableCount + static_cast<uint32_t>(i); });
        for (PropertyOffset offset = 0; offset < static_cast<PropertyOffset>(implicitShape.program.size()); ++offset) {
            JSValue value;
            switch (static_cast<Field>(implicitShape.program[offset])) {
            case Field::Set:
                value = mapOf(mapStructure, variables.span());
                break;
            case Field::Variables:
                value = array(variables.span(), m_variables);
                break;
            case Field::Through:
                value = array(through, m_references);
                break;
            default:
                value = implicitShape.like->getDirect(offset);
            }
            RETURN_IF_EXCEPTION(scope, void());
            implicit->putDirectOffset(m_vm, offset, value);
        }
    }

    JSGlobalObject* m_globalObject;
    VM& m_vm;
    const LintScopes& m_message;
    JSArray* m_nodes;
    JSArray* m_names;
    JSArray* m_strings;
    JSString* m_text;
    Structure* m_arrayStructure;
    JSArray* m_scopes { nullptr };
    JSArray* m_variables { nullptr };
    JSArray* m_definitions { nullptr };
    JSArray* m_references { nullptr };
    JSWeakMap* m_declaredVariables { nullptr };
    // Where the last node that was asked for its name has it.
    StructureID m_nameStructure;
    PropertyOffset m_nameOffset { invalidOffset };

public:
    // Where every shape of a variable has `name`.
    PropertyOffset m_variableNameOffset { invalidOffset };
};

} // namespace

// `scopes(layout, buffer, nodes, names, strings, text)` returns
// `[scopeManager.scopes, scopes, variables, nodeToScope, declaredVariables, definitions, references]`. All but the first and the
// two `WeakMap`s are indexed as in the message in `buffer`.
// `layout`: `[scopes, variables, definitions, references, [implicit], [map, weakMap, globalSet]]`. Each of the first five is a list
// of a template from `shape` followed by its program, a `Uint8Array` with a `Field` for each property. They are found by the
// `ScopeKind`, the shape of a variable, the `DeclarationKind`, and whether a reference writes. The last has an empty instance of
// each class.
// `names`: the configured globals. `strings`: `arguments`, the three settings of a global, the five kinds of a declaration.
JSC_DEFINE_HOST_FUNCTION(jsLintScopes, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto outOfStep = [&] { return throwVMTypeError(globalObject, scope, "The scopes are not as expected"_s); };
    // An array without holes, which can be read without running anything a plugin could have changed.
    auto denseArray = [](JSValue value) -> JSArray* {
        JSArray* array = dynamicDowncast<JSArray>(value);
        for (unsigned i = 0; array && i < array->length(); ++i) {
            if (!array->canGetIndexQuickly(i))
                return nullptr;
        }
        return array;
    };

    JSArray* layout = denseArray(callFrame->argument(0));
    auto* buffer = dynamicDowncast<JSArrayBuffer>(callFrame->argument(1));
    JSArray* nodes = denseArray(callFrame->argument(2));
    JSArray* names = denseArray(callFrame->argument(3));
    JSArray* strings = denseArray(callFrame->argument(4));
    JSValue textValue = callFrame->argument(5);
    if (!layout || layout->length() != 6 || !buffer || !nodes || !names || !strings || strings->length() != stringCount || !textValue.isString())
        return outOfStep();
    JSString* text = asString(textValue);
    text->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    LintScopes message;
    if (!message.read(buffer->impl()->span(), nodes->length(), names->length(), text->length()))
        return outOfStep();
    LintScopeMaker maker(globalObject, message, nodes, names, strings, text);

    // Reads a list of templates and programs. `false`: it's not as expected.
    auto readShapes = [&](unsigned group, auto& shapes) {
        JSArray* list = denseArray(layout->getIndexQuickly(group));
        if (!list || list->length() % 2)
            return false;
        for (unsigned i = 0; i < list->length(); i += 2) {
            Shape shape;
            auto* like = dynamicDowncast<JSFinalObject>(list->getIndexQuickly(i));
            auto* program = dynamicDowncast<JSUint8Array>(list->getIndexQuickly(i + 1));
            if (like && program && !program->isDetached()) {
                shape = { like, program->typedSpan() };
                if (shape.program.empty() || like->structure()->maxOffset() != static_cast<PropertyOffset>(shape.program.size()) - 1)
                    return false;
                for (uint8_t field : shape.program) {
                    if (field >= static_cast<uint8_t>(Field::Count))
                        return false;
                }
            }
            shapes.append(shape);
        }
        return true;
    };
    Vector<Shape, 1> implicitShapes;
    if (!readShapes(0, maker.scopeShapes) || !readShapes(1, maker.variableShapes) || !readShapes(2, maker.definitionShapes) || !readShapes(3, maker.referenceShapes) || !readShapes(4, implicitShapes) || implicitShapes.size() != 1)
        return outOfStep();
    maker.implicitShape = implicitShapes[0];
    for (const Shape& shape : maker.variableShapes) {
        if (!shape.like)
            continue;
        auto name = std::ranges::find(shape.program, static_cast<uint8_t>(Field::Name)) - shape.program.begin();
        if (name == static_cast<ptrdiff_t>(shape.program.size()) || (isValidOffset(maker.m_variableNameOffset) && maker.m_variableNameOffset != name))
            return outOfStep();
        maker.m_variableNameOffset = static_cast<PropertyOffset>(name);
    }
    JSArray* instances = denseArray(layout->getIndexQuickly(5));
    if (!instances || instances->length() != 3)
        return outOfStep();
    auto* map = dynamicDowncast<JSMap>(instances->getIndexQuickly(0));
    auto* weakMap = dynamicDowncast<JSWeakMap>(instances->getIndexQuickly(1));
    auto* globalSet = dynamicDowncast<JSMap>(instances->getIndexQuickly(2));
    if (!map || !weakMap || !globalSet || !maker.hasShapes())
        return outOfStep();
    maker.mapStructure = map->structure();
    maker.weakMapStructure = weakMap->structure();
    maker.globalSetStructure = globalSet->structure();

    JSValue result = maker.make();
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(result);
}

// Adds what the program in src/lint/js_plugin/worker calls to its `native` object.
void addLintScopeFunctions(JSGlobalObject* globalObject, JSObject* native)
{
    VM& vm = globalObject->vm();
    native->putDirect(vm, Identifier::fromString(vm, "scopes"_s), JSFunction::create(vm, globalObject, 6, "scopes"_s, jsLintScopes, ImplementationVisibility::Public));
}

} // namespace Bun
