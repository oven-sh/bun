// Builds the scope manager's objects for JavaScript lint plugins from the arrays written by src/lint/js_plugin/scopes.rs.
// One call per file.
//
// The objects are what `eslint-scope` or `@typescript-eslint/scope-manager` make: plain objects with own data properties in
// the same order. src/lint/js_plugin/worker/scope.js has the classes with their methods. Which property goes where is here.

#include "root.h"

#include "LintHost.h"
#include <JavaScriptCore/CustomGetterSetter.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGenericTypedArrayViewInlines.h>
#include <JavaScriptCore/JSMapInlines.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <JavaScriptCore/JSWeakMapInlines.h>
#include <JavaScriptCore/ObjectInitializationScope.h>

namespace Bun {
using namespace JSC;

// LintNodes.cpp
JSArray* tryCreateFilledLintArray(VM&, JSGlobalObject*, unsigned length);

namespace {

constexpr uint32_t none = UINT32_MAX;

// What goes into a property. `fieldNames` has the same order.
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
    // Of a variable and of a reference.
    Tainted,
    // Of a reference of typescript-eslint, and what is in it besides `Node`.
    MaybeImplicitGlobal,
    Pattern,
    Count,
};

// The message. src/lint/js_plugin/scopes.rs documents the layout.
struct LintScopes {
    static constexpr size_t headerWords = 11, scopeWords = 9, variableWords = 8, definitionWords = 7, referenceWords = 6;

    uint32_t scopeCount, declaredCount, variableCount, definitionCount, referenceCount, implicitCount;
    // How many of the implicit globals are in `globalScope.implicit`. They come first.
    uint32_t keptImplicitCount;
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
        keptImplicitCount = words[10];
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
        if (!fits || !scopeCount || declaredCount > variableCount || keptImplicitCount > implicitCount)
            return false;

        for (uint32_t i = 0; i < scopeCount; ++i) {
            auto it = scope(i);
            if (it[1] >= nodeCount || !isIndexOrNone(it[2], scopeCount) || it[3] >= scopeCount)
                return false;
            if (!isListOf(it[4], variableCount) || !isListOf(it[5], scopeCount) || !isListOf(it[6], variableCount) || !isListOf(it[7], referenceCount) || !isListOf(it[8], referenceCount))
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
                if (!isListOf(name, 0x10000))
                    return false;
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
            if (it[0] >= nodeCount || !isIndexOrNone(it[2], nodeCount) || !isIndexOrNone(it[3], variableCount) || it[4] >= scopeCount || !isIndexOrNone(it[5], nodeCount))
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
constexpr uint32_t isType = 1, isValue = 2, isUsed = 4, isStack = 256, isTaintedVariable = 512;
// In the kind of a scope.
constexpr uint32_t isStrict = 256, hasThis = 512, hasArguments = 1024;
// In the flags of a reference.
constexpr uint32_t isWrite = 2, isInit = 8, isPartial = 512, isTainted = 1024, hasNullImplicitGlobal = 2048;
// In the flags of a definition.
constexpr uint32_t isRest = 1, lacksParent = 2;
// In `strings`.
constexpr uint32_t argumentsString = 0, firstSetting = 1, firstKind = 4, stringCount = 9;
// In the group of definitions, after the kinds of the message.
constexpr uint32_t implicitGlobalVariable = 10;

// ───────────── which property goes where ─────────────

// The names of the properties that the `Field`s after `Copy` are for.
constexpr ASCIILiteral fieldNames = "$id set taints block through variables references variableScope upper isStrict thisFound childScopes __declaredVariables implicit name identifiers defs stack scope eslintUsed eslintExported eslintImplicitGlobalSetting eslintExplicitGlobal writeable isTypeVariable isValueVariable node parent index kind rest identifier from resolved flag writeExpr partial init tainted maybeImplicitGlobal pattern"_s;
// In the order of `ScopeKind` and `DeclarationKind` in src/lint/js_plugin/scopes.rs.
constexpr ASCIILiteral scopeTypes = "global module function function-expression-name block switch catch with for class class-field-initializer class-static-block tsModule tsEnum type conditionalType functionType mappedType"_s;
constexpr ASCIILiteral definitionTypes = "Variable Parameter FunctionName ClassName CatchClause ImportBinding TSEnumName TSEnumMemberName TSModuleName Type ImplicitGlobalVariable"_s;

enum Group : uint8_t {
    Scopes,
    Variables,
    Definitions,
    References,
    Implicit,
    MaybeImplicit,
};
constexpr std::array<uint32_t, 6> templatesIn { 18, 16, 11, 2, 1, 1 };
constexpr std::array<uint32_t, 6> firstTemplateIn { 0, 18, 34, 45, 47, 48 };

StringView wordAt(ASCIILiteral words, uint32_t index)
{
    for (StringView word : StringView(words).split(' ')) {
        if (!index--)
            return word;
    }
    return {};
}

// Makes what `shapeIn` returns. It runs once for each shape.
__attribute__((minsize)) NEVER_INLINE Shape makeShapeIn(JSGlobalObject* globalObject, LintHost* host, LintScopeFlavor flavor, Group group, uint32_t index)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintScopeLayout& layout = host->scopes.layoutOf(flavor);
    bool isEspree = flavor == LintScopeFlavor::EslintScope;
    size_t at = firstTemplateIn[group] + index;

    Vector<StringView, 24> keys;
    auto add = [&](ASCIILiteral words) {
        for (StringView word : StringView(words).split(' '))
            keys.append(word);
    };
    // `classes[outer]`, or `classes[outer][inner]`
    auto classAt = [&](unsigned outer, std::optional<uint32_t> inner = std::nullopt) {
        JSValue found = layout.classes->tryGetIndexQuickly(outer);
        if (!inner)
            return found;
        JSArray* list = found ? dynamicDowncast<JSArray>(found) : nullptr;
        return list ? list->tryGetIndexQuickly(*inner) : JSValue();
    };
    JSValue type;
    switch (group) {
    case Scopes:
        type = classAt(0, index);
        add(isEspree ? "type set taints dynamic block through variables references variableScope functionExpressionScope directCallToEvalScope thisFound __left upper isStrict childScopes __declaredVariables"_s : "$id block childScopes functionExpressionScope isStrict leftToResolve references set through type upper variables variableScope"_s);
        if (!index)
            add("implicit"_s);
        break;
    case Variables:
        // See `SHAPE_GLOBAL` in scopes.rs. Only typescript-eslint has variables of libraries, and all of its variables have `eslintUsed`.
        if ((index & 3) == 3 || (isEspree && (index & 2)) || (!isEspree && (index & 4)))
            return {};
        type = classAt(index & 2 ? 2 : 1);
        add(isEspree ? "name identifiers references defs tainted stack scope"_s : "$id defs eslintUsed identifiers name references scope"_s);
        if (index & 1)
            add(flavor == LintScopeFlavor::Oxlint ? "writeable eslintImplicitGlobalSetting eslintExplicitGlobal eslintExplicitGlobalComments"_s : "eslintImplicitGlobalSetting eslintExplicitGlobal eslintExplicitGlobalComments writeable"_s);
        if (index & 2)
            add("writeable eslintExplicitGlobal eslintImplicitGlobalSetting eslintExplicitGlobalComments isTypeVariable isValueVariable"_s);
        if (index & 4)
            add("eslintUsed"_s);
        if (index & 8)
            add("eslintExported"_s);
        break;
    case Definitions:
        type = classAt(3, index);
        add(isEspree ? "type name node parent index kind"_s : "$id type name node parent isTypeDefinition isVariableDefinition"_s);
        if (index == 1)
            add("rest"_s);
        break;
    case References:
        type = classAt(4);
        if (!isEspree)
            add("$id from identifier init maybeImplicitGlobal resolved writeExpr"_s);
        else {
            add("identifier from tainted resolved flag"_s);
            if (index)
                add("writeExpr partial init"_s);
            add("__maybeImplicitGlobal"_s);
        }
        break;
    case Implicit:
        add(isEspree ? "set variables left"_s : "leftToBeResolved set variables"_s);
        break;
    case MaybeImplicit:
        add("node pattern"_s);
        break;
    }
    JSValue prototype = globalObject->objectPrototype();
    if (group != Implicit && group != MaybeImplicit) {
        if (!type || !type.isObject())
            return {};
        prototype = asObject(type)->get(globalObject, vm.propertyNames->prototype);
        RETURN_IF_EXCEPTION(scope, {});
        if (!prototype.isObject())
            return {};
    }

    // What is the same in all of the objects. Empty: nothing is, or it's `undefined`.
    auto constantOf = [&](StringView key) -> JSValue {
        auto string = [&](StringView text) { return jsOwnedString(vm, AtomString(text.span8())); };
        if (group == Scopes) {
            if (key == "type"_s)
                return string(wordAt(scopeTypes, index));
            if (key == "dynamic"_s)
                return jsBoolean(!index || wordAt(scopeTypes, index) == "with"_s);
            if (key == "functionExpressionScope"_s)
                return jsBoolean(wordAt(scopeTypes, index) == "function-expression-name"_s);
            if (key == "directCallToEvalScope"_s)
                return jsBoolean(false);
            if (key == "__left"_s || key == "leftToResolve"_s)
                return jsNull();
        }
        if (group == Definitions) {
            StringView kind = wordAt(definitionTypes, index);
            bool isImplicit = index == implicitGlobalVariable;
            if (key == "type"_s)
                return string(kind);
            if (key == "isTypeDefinition"_s)
                return jsBoolean(kind == "ClassName"_s || kind == "ImportBinding"_s || kind.startsWith("TS"_s) || kind == "Type"_s);
            if (key == "isVariableDefinition"_s)
                return jsBoolean(kind != "Type"_s);
            if (key == "parent"_s && (isImplicit || (isEspree && index == 1)))
                return jsNull();
            if (key == "kind"_s && (isImplicit || index == 1))
                return jsNull();
            if (key == "index"_s && isImplicit)
                return jsNull();
        }
        return {};
    };
    auto fieldOf = [&](StringView key) -> uint8_t {
        if (group == Implicit && key.startsWith("left"_s))
            return static_cast<uint8_t>(Field::Through);
        uint8_t field = 1;
        for (StringView name : StringView(fieldNames).split(' ')) {
            if (name == key)
                return field;
            ++field;
        }
        return static_cast<uint8_t>(Field::Copy);
    };

    JSFinalObject* like = JSFinalObject::create(vm, JSFinalObject::createStructure(vm, globalObject, prototype, keys.size()));
    layout.templates[at].set(vm, host, like);
    Vector<uint8_t> program;
    for (StringView key : keys) {
        JSValue constant = constantOf(key);
        Identifier name = Identifier::fromString(vm, AtomString(key.span8()));
        // To a plugin it's a plain property.
        if (JSCell* lazy = host->scopes.lazyVariables.get(); lazy && group == Scopes && !index && flavor == LintScopeFlavor::TypeScript && key == "variables"_s) {
            like->putDirectCustomAccessor(vm, name, lazy, static_cast<unsigned>(PropertyAttribute::CustomValue));
            program.append(static_cast<uint8_t>(Field::Copy));
            continue;
        }
        like->putDirect(vm, name, constant ? constant : jsUndefined());
        program.append(constant ? static_cast<uint8_t>(Field::Copy) : fieldOf(key));
    }
    RELEASE_ASSERT(like->structure()->maxOffset() == static_cast<PropertyOffset>(keys.size()) - 1);
    layout.programs[at] = WTF::move(program);
    return { like, layout.programs[at].span() };
}

// The shape of the objects `index` of `group`. Without a template: there are no such objects, or an exception was thrown.
Shape shapeIn(JSGlobalObject* globalObject, LintHost* host, LintScopeFlavor flavor, Group group, uint32_t index)
{
    if (index >= templatesIn[group])
        return {};
    size_t at = firstTemplateIn[group] + index;
    LintScopeLayout& layout = host->scopes.layoutOf(flavor);
    if (JSObject* like = layout.templates[at].get()) [[likely]]
        return { like, layout.programs[at].span() };
    return makeShapeIn(globalObject, host, flavor, group, index);
}

// `map.set(key, value)`. What it takes is several KB, so it's here once.
NEVER_INLINE void setInMap(JSGlobalObject* globalObject, JSMap* map, JSValue key, JSValue value)
{
    map->set(globalObject, key, value);
}

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
    Shape implicitShape, maybeImplicitShape;

    // Takes the shapes that the objects of the message need from the layouts of the host.
    void takeShapes(LintHost* host, LintScopeFlavor flavor)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        auto take = [&](auto& shapes, Group group, uint32_t index) {
            if (index < shapes.size() && !shapes[index].like)
                shapes[index] = shapeIn(m_globalObject, host, flavor, group, index);
        };
        scopeShapes.grow(templatesIn[Scopes]);
        variableShapes.grow(templatesIn[Variables]);
        definitionShapes.grow(templatesIn[Definitions]);
        referenceShapes.grow(templatesIn[References]);
        for (uint32_t i = 0; i < m_message.scopeCount; ++i) {
            take(scopeShapes, Scopes, m_message.scope(i)[0] & 255);
            RETURN_IF_EXCEPTION(scope, void());
        }
        take(variableShapes, Variables, 0);
        RETURN_IF_EXCEPTION(scope, void());
        for (uint32_t i = 0; i < m_message.variableCount; ++i) {
            take(variableShapes, Variables, m_message.variable(i)[6] >> 8);
            RETURN_IF_EXCEPTION(scope, void());
        }
        take(definitionShapes, Definitions, implicitGlobalVariable);
        RETURN_IF_EXCEPTION(scope, void());
        for (uint32_t i = 0; i < m_message.definitionCount; ++i) {
            take(definitionShapes, Definitions, m_message.definition(i)[0]);
            RETURN_IF_EXCEPTION(scope, void());
        }
        take(referenceShapes, References, 0);
        RETURN_IF_EXCEPTION(scope, void());
        take(referenceShapes, References, 1);
        RETURN_IF_EXCEPTION(scope, void());
        implicitShape = shapeIn(m_globalObject, host, flavor, Implicit, 0);
        RETURN_IF_EXCEPTION(scope, void());
        scope.release();
        maybeImplicitShape = shapeIn(m_globalObject, host, flavor, MaybeImplicit, 0);
    }
    Structure* mapStructure { nullptr };
    Structure* weakMapStructure { nullptr };
    // For `set` of the global scope.
    Structure* globalSetStructure { nullptr };

    // After `make`.
    JSMap* setOfGlobalScope() { return m_setOfGlobalScope; }
    JSArray* variablesOfGlobalScope() { return array(m_message.scope(0)[6], m_variables); }
    JSMap* mapOfGlobalScope() { return mapOf(mapStructure, m_message.list(m_message.scope(0)[6])); }
    // See `LintScopeState::globalSet`.
    bool leavesGlobalSetEmpty { false };

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
        return has(variableShapes, 0) && has(definitionShapes, implicitGlobalVariable) && has(referenceShapes, 0) && has(referenceShapes, 1) && implicitShape.like && maybeImplicitShape.like;
    }

    // `[scopeManager.scopes, scopes, variables, nodeToScope, declaredVariables, definitions, references]`. All but the first and the two
    // `WeakMap`s are indexed as in the message. Empty if an exception was thrown.
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
    // An array of `length` times `undefined`. Throws if there's no memory.
    JSArray* emptyArray(uint32_t length)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        JSArray* array = tryCreateFilledLintArray(m_vm, m_globalObject, length);
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

    // The data property `name` of `object`. Empty if it has none. It never runs a getter.
    JSValue dataProperty(JSObject* object, PropertyName name)
    {
        unsigned attributes;
        PropertyOffset offset = object->structure()->get(m_vm, name, attributes);
        bool isData = isValidOffset(offset) && !(attributes & (PropertyAttribute::Accessor | PropertyAttribute::CustomAccessorOrValue));
        return isData ? object->getDirect(offset) : JSValue();
    }

    // `node.name`, or `String(node.value)` of a `Literal`. `undefined` if a plugin has changed the node so that it has neither.
    JSValue nameOfNode(uint32_t id)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        JSObject* node = m_nodes->getIndexQuickly(id).getObject();
        if (!node) [[unlikely]]
            return jsUndefined();
        // Nearly all are `Identifier`s, which have one Structure.
        if (node->structureID() == m_nameStructure) [[likely]]
            return node->getDirect(m_nameOffset);
        unsigned attributes;
        PropertyOffset offset = node->structure()->get(m_vm, m_vm.propertyNames->name, attributes);
        if (isValidOffset(offset) && !attributes) {
            m_nameStructure = node->structureID();
            m_nameOffset = offset;
            return node->getDirect(offset);
        }
        JSValue value = dataProperty(node, m_vm.propertyNames->name);
        if (!value)
            value = dataProperty(node, m_vm.propertyNames->value);
        if (!value || value.isObject() || value.isSymbol())
            return jsUndefined();
        JSString* name = value.toString(m_globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        return name;
    }

    JSValue nameOf(uint32_t word)
    {
        uint32_t number = word >> 2;
        switch (word & 3) {
        case 0:
            return nameOfNode(number);
        case 1: {
            if (!number)
                return string(argumentsString);
            Vector<char16_t, 32> units(m_message.list(number).size(), [&](size_t i) { return static_cast<char16_t>(m_message.list(number)[i]); });
            return jsString(m_vm, String(units.span()));
        }
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
            setInMap(m_globalObject, map, variable->getDirect(m_variableNameOffset), variable);
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
                value = !hasParent ? jsUndefined() : it[4] == none ? jsNull()
                                                                   : jsNumber(it[4]);
                break;
            case Field::Kind:
                value = !hasParent ? jsUndefined() : it[6] ? string(firstKind + it[6] - 1)
                                                           : jsNull();
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
            case Field::Tainted:
                value = jsBoolean(it[1] & isTainted);
                break;
            case Field::MaybeImplicitGlobal:
                if (it[5] != none) {
                    // `{ node, pattern }`
                    JSObject* object = JSFinalObject::create(m_vm, maybeImplicitShape.like->structure());
                    object->putDirectOffset(m_vm, 0, m_nodes->getIndexQuickly(it[5]));
                    object->putDirectOffset(m_vm, 1, m_nodes->getIndexQuickly(it[0]));
                    value = object;
                } else
                    value = it[1] & hasNullImplicitGlobal ? jsNull() : jsUndefined();
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
            case Field::Tainted:
                value = jsBoolean(flags & isTaintedVariable);
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
                // ESLint sets it for the names that it knows. A library of TypeScript isn't among what it knows.
                value = settings & 8 ? jsBoolean(settings & 16) : jsUndefined();
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
            case Field::Tainted:
                value = jsBoolean(false);
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
                    definition->putDirectOffset(m_vm, at, field == Field::Name ? m_nodes->getIndexQuickly(pairs[i]) : field == Field::Node ? nodeOrNull(pairs[i + 1])
                            : field == Field::Id                                                                                           ? jsNumber(m_message.definitionCount + i / 2 + 1)
                                                                                                                                           : definitionShape.like->getDirect(at));
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
                if (!index && leavesGlobalSetEmpty) {
                    m_setOfGlobalScope = JSMap::create(m_vm, globalSetStructure);
                    value = m_setOfGlobalScope;
                } else
                    value = mapOf(index ? mapStructure : globalSetStructure, m_message.list(it[6]));
                break;
            case Field::Taints: {
                JSMap* taints = JSMap::create(m_vm, mapStructure);
                value = taints;
                if (it[0] & hasArguments)
                    setInMap(m_globalObject, taints, string(argumentsString), jsBoolean(true));
                for (uint32_t variable : m_message.list(it[4])) {
                    RETURN_IF_EXCEPTION(scope, void());
                    setInMap(m_globalObject, taints, asObject(m_variables->getIndexQuickly(variable))->getDirect(m_variableNameOffset), jsBoolean(true));
                }
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
                value = jsBoolean(it[0] & isStrict);
                break;
            case Field::ThisFound:
                value = jsBoolean(it[0] & hasThis);
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
        Vector<uint32_t, 8> variables(m_message.keptImplicitCount, [&](size_t i) { return m_message.variableCount + static_cast<uint32_t>(i); });
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
    JSMap* m_setOfGlobalScope { nullptr };
    // Where the last node that was asked for its name has it.
    StructureID m_nameStructure;
    PropertyOffset m_nameOffset { invalidOffset };

public:
    // Where every shape of a variable has `name`.
    PropertyOffset m_variableNameOffset { invalidOffset };
};

// ───────────── what the libraries of TypeScript define ─────────────

// The name with the number `id`. Null: there's none, or an exception was thrown.
JSString* libName(JSGlobalObject* globalObject, LintHost* host, uint32_t id)
{
    constexpr uint32_t askForName = 17;
    VM& vm = globalObject->vm();
    auto& names = host->scopes.libNames;
    if (id >= names.size())
        return nullptr;
    if (!names[id]) {
        LintSpan answer = Bun__Lint__ask(globalObject, askForName, reinterpret_cast<const uint8_t*>(&id), sizeof(id));
        names[id].set(vm, host, jsOwnedString(vm, AtomString(std::span { byteCast<Latin1Character>(answer.ptr), answer.len })));
    }
    return names[id].get();
}

// A variable that the libraries define, and that nothing in the file or in the configuration mentions. `entry`: see `LIB_VARIABLES` in
// src/lint/js_plugin/wire.rs. Null: an exception was thrown.
JSObject* makeQuietLibVariable(JSGlobalObject* globalObject, LintHost* host, const Shape& shape, JSString* name, uint32_t entry)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintScopeState& state = host->scopes;
    JSFinalObject* variable = JSFinalObject::create(vm, shape.like->structure());
    for (PropertyOffset offset = 0; offset < static_cast<PropertyOffset>(shape.program.size()); ++offset) {
        JSValue value;
        switch (static_cast<Field>(shape.program[offset])) {
        case Field::Id:
            value = jsNumber(state.variables->length() + ++state.quietLibVariables);
            break;
        case Field::Name:
            value = name;
            break;
        case Field::Defs:
        case Field::Identifiers:
        case Field::References:
            value = constructEmptyArray(globalObject, nullptr);
            RETURN_IF_EXCEPTION(scope, nullptr);
            break;
        case Field::Scope:
            value = state.globalScope.get();
            break;
        case Field::EslintUsed:
        case Field::Writeable:
            value = jsBoolean(false);
            break;
        case Field::EslintImplicitGlobalSetting:
            value = state.strings->getIndexQuickly(firstSetting);
            break;
        case Field::EslintExplicitGlobal:
            value = jsUndefined();
            break;
        case Field::IsTypeVariable:
            value = jsBoolean(entry & isType);
            break;
        case Field::IsValueVariable:
            value = jsBoolean(entry & isValue);
            break;
        default:
            value = shape.like->getDirect(offset);
        }
        variable->putDirectOffset(vm, offset, value);
    }
    return variable;
}

constexpr uint32_t shapeOfLibVariable = 2;

// Makes the rest of them, and puts all into `variables` and `set` of the global scope. typescript-eslint defines what is in the libraries
// first. It goes by what the host knows: a plugin can have changed the variables, and written to `set`. Returns `variables`, or null if
// it has been here before or an exception was thrown.
JSArray* addAllLibVariables(JSGlobalObject* globalObject, LintHost* host)
{
    constexpr uint32_t askForAll = 16;
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintScopeState& state = host->scopes;
    if (state.hasAllLibVariables)
        return nullptr;
    state.hasAllLibVariables = true;
    LintSpan answer = Bun__Lint__ask(globalObject, askForAll, nullptr, 0);
    std::span<const uint32_t> words { reinterpret_cast<const uint32_t*>(answer.ptr), answer.len / 4 };
    Shape shape = shapeIn(globalObject, host, LintScopeFlavor::TypeScript, Variables, shapeOfLibVariable);
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (words.size() < 2 || words[1] != words.size() - 2 || reinterpret_cast<uintptr_t>(answer.ptr) % 4 || !shape.like) {
        throwTypeError(globalObject, scope, "The scopes are not as expected"_s);
        return nullptr;
    }
    JSMap* known = state.knownGlobals.get();
    JSArray* mentioned = state.mentionedGlobals.get();
    // Those that the file declares, or that only ESLint knows. A name that a library has as well is only among these.
    UncheckedKeyHashSet<JSCell*> others;
    for (unsigned i = 0; i < mentioned->length(); ++i) {
        if (!state.mentionedAreOfLib[i])
            others.add(mentioned->getIndexQuickly(i).asCell());
    }

    MarkedArgumentBuffer all, names;
    for (uint32_t entry : words.subspan(2)) {
        JSString* name = libName(globalObject, host, entry >> 2);
        if (!name)
            continue;
        JSValue variable = known->get(globalObject, name);
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (variable.isUndefined()) {
            variable = makeQuietLibVariable(globalObject, host, shape, name, entry);
            RETURN_IF_EXCEPTION(scope, nullptr);
        } else if (others.contains(variable.asCell()))
            continue;
        all.append(variable);
        names.append(name);
    }
    for (unsigned i = 0; i < mentioned->length(); ++i) {
        if (state.mentionedAreOfLib[i])
            continue;
        all.append(mentioned->getIndexQuickly(i));
        names.append(state.mentionedNames->getIndexQuickly(i));
    }
    JSArray* variables = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), all);
    RETURN_IF_EXCEPTION(scope, nullptr);
    // `GlobalSet` in scope.js comes here before it writes. Only `Map.prototype.set.call(set, ..)` has put something there earlier, which stays.
    JSMap* set = state.globalSet.get();
    bool isEmpty = !set->size();
    for (size_t i = 0; i < all.size(); ++i) {
        if (!isEmpty) [[unlikely]] {
            bool has = set->has(globalObject, names.at(i));
            RETURN_IF_EXCEPTION(scope, nullptr);
            if (has)
                continue;
        }
        setInMap(globalObject, set, names.at(i), all.at(i));
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    lintReplaceCustomValue(vm, host, state.globalScope.get(), Identifier::fromString(vm, "variables"_s), variables);
    return variables;
}

JSC_DEFINE_CUSTOM_GETTER(lintLazyVariablesOfGlobalScope, (JSGlobalObject*, EncodedJSValue thisValue, PropertyName))
{
    JSGlobalObject* globalObject = LintHost::realmOfHolder(thisValue);
    if (!globalObject) [[unlikely]]
        return JSValue::encode(jsUndefined());
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    LintHost* host = LintHost::from(globalObject);
    // That of a file that is done.
    if (JSValue::decode(thisValue) != JSValue(host->scopes.globalScope.get()))
        return JSValue::encode(jsUndefined());
    JSArray* variables = addAllLibVariables(globalObject, host);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(variables ? JSValue(variables) : jsUndefined());
}

} // namespace

// `addLibVariables(set)`: see `addAllLibVariables`. `set`: that of the global scope. A plugin can have kept that of another file.
JSC_DEFINE_HOST_FUNCTION(jsLintAddLibVariables, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    LintHost* host = LintHost::from(globalObject);
    if (callFrame->argument(0) == JSValue(host->scopes.globalSet.get()))
        addAllLibVariables(globalObject, host);
    return JSValue::encode(jsUndefined());
}

// `globalVariable(name, set)`: the variable `name` of the global scope, as long as not all of them are in its `set`. One that the libraries of
// TypeScript define and nothing mentions is made. `undefined`: there's none, or all are in `set`.
JSC_DEFINE_HOST_FUNCTION(jsLintGlobalVariable, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    constexpr uint32_t askForOne = 18;
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintHost* host = LintHost::from(globalObject);
    LintScopeState& state = host->scopes;
    JSValue name = callFrame->argument(0);
    if (state.hasAllLibVariables || !name.isString() || callFrame->argument(1) != JSValue(state.globalSet.get()))
        return JSValue::encode(jsUndefined());
    JSValue made = state.knownGlobals->get(globalObject, name);
    RETURN_IF_EXCEPTION(scope, {});
    if (!made.isUndefined())
        return JSValue::encode(made);
    auto text = asString(name)->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    // All of the names are ASCII.
    if (!text->is8Bit() || !text->containsOnlyASCII())
        return JSValue::encode(jsUndefined());
    auto bytes = text->span8();
    LintSpan answer = Bun__Lint__ask(globalObject, askForOne, byteCast<uint8_t>(bytes.data()), bytes.size());
    if (answer.len != 4)
        return JSValue::encode(jsUndefined());
    uint32_t entry;
    memcpy(&entry, answer.ptr, 4);
    Shape shape = shapeIn(globalObject, host, LintScopeFlavor::TypeScript, Variables, shapeOfLibVariable);
    RETURN_IF_EXCEPTION(scope, {});
    JSString* known = libName(globalObject, host, entry >> 2);
    if (!shape.like || !known)
        return JSValue::encode(jsUndefined());
    JSObject* variable = makeQuietLibVariable(globalObject, host, shape, known, entry);
    RETURN_IF_EXCEPTION(scope, {});
    setInMap(globalObject, state.knownGlobals.get(), known, variable);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(variable);
}

// `scopes(classes, names, wantsFlags)` asks Rust for the scopes of the file that's being linted, whose nodes have been made, and returns
// `[scopeManager.scopes, nodeToScope, declaredVariables, flags, explicit]`.
// `flags`: a `Uint32Array` with the flags of each reference, if `wantsFlags`. `explicit`: each variable that `/* global */` comments
// name, followed by a list of where these comments start.
// `classes`: `[scopes, Variable, ImplicitLibVariable, definitions, Reference, globalSet]`, those of the scopes by the `ScopeKind` and those
// of the definitions by the `DeclarationKind`, and an empty `set` for the global scope. It has to be the same array each time.
// `names`: the configured globals.
// With typescript-eslint under ESLint `set` of the global scope is empty: see `globalVariable` and `addLibVariables`.
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

    LintHost* host = LintHost::from(globalObject);
    JSArray* layout = denseArray(callFrame->argument(0));
    JSArray* names = denseArray(callFrame->argument(1));
    if (!host->scopes.strings) {
        MarkedArgumentBuffer all;
        for (StringView text : StringView("arguments|readonly|writable|off|var|let|const|using|await using"_s).split('|'))
            all.append(jsOwnedString(vm, AtomString(text.span8())));
        JSArray* made = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), all);
        RETURN_IF_EXCEPTION(scope, {});
        host->scopes.strings.set(vm, host, made);
    }
    JSArray* strings = host->scopes.strings.get();
    JSArray* nodes = host->sourceCode.nodes.get();
    if (!layout || layout->length() != 6 || !nodes || !names || !host->isLinting())
        return outOfStep();
    constexpr uint32_t scopesOfFile = 9;
    LintSpan answer = Bun__Lint__ask(globalObject, scopesOfFile, nullptr, 0);
    std::span<const uint8_t> bytes { answer.ptr, answer.len };
    JSString* text = host->text();

    LintScopes message;
    if (!message.read(bytes, nodes->length(), names->length(), text->length()))
        return outOfStep();
    LintScopeMaker maker(globalObject, message, nodes, names, strings, text);

    LintScopeFlavor flavor = host->isOxlint() ? LintScopeFlavor::Oxlint : host->isEspree() ? LintScopeFlavor::EslintScope
                                                                                           : LintScopeFlavor::TypeScript;
    // oxlint has no libraries.
    bool makesLibVariables = flavor == LintScopeFlavor::TypeScript;
    if (makesLibVariables && !host->scopes.lazyVariables) {
        constexpr uint32_t askForAll = 16;
        LintSpan libs = Bun__Lint__ask(globalObject, askForAll, nullptr, 0);
        if (libs.len < 8 || reinterpret_cast<uintptr_t>(libs.ptr) % 4)
            return outOfStep();
        host->scopes.lazyVariables.set(vm, host, CustomGetterSetter::create(vm, lintLazyVariablesOfGlobalScope, nullptr));
        // The collector can be looking at the host.
        Locker locker { host->cellLock() };
        host->scopes.libNames.grow(*reinterpret_cast<const uint32_t*>(libs.ptr));
    }
    LintScopeLayout& known = host->scopes.layoutOf(flavor);
    if (!known.classes)
        known.classes.set(vm, host, layout);
    if (known.classes.get() != layout)
        return outOfStep();
    maker.takeShapes(host, flavor);
    RETURN_IF_EXCEPTION(scope, {});
    for (const Shape& shape : maker.variableShapes) {
        if (!shape.like)
            continue;
        auto name = std::ranges::find(shape.program, static_cast<uint8_t>(Field::Name)) - shape.program.begin();
        if (name == static_cast<ptrdiff_t>(shape.program.size()) || (isValidOffset(maker.m_variableNameOffset) && maker.m_variableNameOffset != name))
            return outOfStep();
        maker.m_variableNameOffset = static_cast<PropertyOffset>(name);
    }
    auto* globalSet = dynamicDowncast<JSMap>(layout->getIndexQuickly(5));
    if (!globalSet || !maker.hasShapes())
        return outOfStep();
    maker.mapStructure = globalObject->mapStructure();
    maker.weakMapStructure = globalObject->weakMapStructure();
    maker.globalSetStructure = globalSet->structure();
    maker.leavesGlobalSetEmpty = makesLibVariables;

    JSValue result = maker.make();
    RETURN_IF_EXCEPTION(scope, {});
    JSArray* made = asArray(result);
    JSArray* variables = asArray(made->getIndexQuickly(2));
    JSObject* globalScope = asObject(asArray(made->getIndexQuickly(1))->getIndexQuickly(0));
    host->scopes.globalScope.set(vm, host, globalScope);
    host->scopes.nodeToScope.set(vm, host, uncheckedDowncast<JSWeakMap>(made->getIndexQuickly(3)));
    host->scopes.declaredVariables.set(vm, host, uncheckedDowncast<JSWeakMap>(made->getIndexQuickly(4)));
    host->scopes.variables.set(vm, host, variables);
    host->scopes.variableWords = message.variables;
    host->scopes.declaredCount = message.declaredCount;
    if (makesLibVariables) {
        // No plugin has seen the variables yet, so they are as they were made.
        auto ofGlobalScope = message.list(message.scope(0)[6]);
        JSArray* mentioned = maker.variablesOfGlobalScope();
        RETURN_IF_EXCEPTION(scope, {});
        host->scopes.mentionedGlobals.set(vm, host, mentioned);
        MarkedArgumentBuffer namesOfMentioned;
        for (unsigned i = 0; i < mentioned->length(); ++i)
            namesOfMentioned.append(asObject(mentioned->getIndexQuickly(i))->getDirect(maker.m_variableNameOffset));
        JSArray* mentionedNames = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), namesOfMentioned);
        RETURN_IF_EXCEPTION(scope, {});
        host->scopes.mentionedNames.set(vm, host, mentionedNames);
        host->scopes.mentionedAreOfLib = Vector<bool>(ofGlobalScope.size(), [&](size_t i) { return (message.variable(ofGlobalScope[i])[6] >> 8 & shapeOfLibVariable) != 0; });
        JSMap* knownGlobals = maker.mapOfGlobalScope();
        RETURN_IF_EXCEPTION(scope, {});
        host->scopes.knownGlobals.set(vm, host, knownGlobals);
        host->scopes.globalSet.set(vm, host, maker.setOfGlobalScope());
        host->scopes.hasAllLibVariables = false;
    }

    // The program needs none of the objects by their numbers.
    JSArray* forProgram = tryCreateFilledLintArray(vm, globalObject, 5);
    if (!forProgram) [[unlikely]]
        return JSValue::encode(throwOutOfMemoryError(globalObject, scope));
    forProgram->setIndexQuickly(vm, 0, made->getIndexQuickly(0));
    forProgram->setIndexQuickly(vm, 1, made->getIndexQuickly(3));
    forProgram->setIndexQuickly(vm, 2, made->getIndexQuickly(4));
    if (callFrame->argument(2).toBoolean(globalObject)) {
        auto* flags = JSUint32Array::createUninitialized(globalObject, globalObject->typedArrayStructureWithTypedArrayType<TypeUint32>(), message.referenceCount);
        RETURN_IF_EXCEPTION(scope, {});
        for (uint32_t i = 0; i < message.referenceCount; ++i)
            flags->typedVector()[i] = message.reference(i)[1];
        forProgram->setIndexQuickly(vm, 3, flags);
    }
    MarkedArgumentBuffer explicitGlobals;
    for (uint32_t index : message.list(message.scope(0)[6])) {
        auto it = message.variable(index);
        if (!(it[6] & 16) || !message.isList(it[7]))
            continue;
        MarkedArgumentBuffer starts;
        for (uint32_t start : message.list(it[7]))
            starts.append(jsNumber(start));
        JSArray* list = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), starts);
        RETURN_IF_EXCEPTION(scope, {});
        explicitGlobals.append(variables->getIndexQuickly(index));
        explicitGlobals.append(list);
    }
    JSArray* explicitList = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), explicitGlobals);
    RETURN_IF_EXCEPTION(scope, {});
    forProgram->setIndexQuickly(vm, 4, explicitList);
    return JSValue::encode(forProgram);
}

// `usedVariables()`: the indices of the variables that the file declares and for which a rule has set `eslintUsed`, or `undefined` if
// there are none.
JSC_DEFINE_HOST_FUNCTION(jsLintUsedVariables, (JSGlobalObject * globalObject, CallFrame*))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintScopeState& state = LintHost::from(globalObject)->scopes;
    JSArray* variables = state.variables.get();
    if (!variables)
        return JSValue::encode(jsUndefined());
    Identifier eslintUsed = Identifier::fromString(vm, "eslintUsed"_s);
    MarkedArgumentBuffer used;
    for (uint32_t index = 0; index < state.declaredCount; ++index) {
        if (state.variableWords[size_t(index) * LintScopes::variableWords + 2] & isUsed)
            continue;
        JSValue value = lintGet(globalObject, variables->getIndexQuickly(index), eslintUsed);
        RETURN_IF_EXCEPTION(scope, {});
        if (value.toBoolean(globalObject))
            used.append(jsNumber(index));
    }
    if (used.isEmpty())
        return JSValue::encode(jsUndefined());
    RELEASE_AND_RETURN(scope, JSValue::encode(constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), used)));
}

// `setScopeManager(manager)` keeps `sourceCode.scopeManager` of the file, which scope.js makes around what `scopes` returns.
JSC_DEFINE_HOST_FUNCTION(jsLintSetScopeManager, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    LintHost* host = LintHost::from(globalObject);
    if (JSObject* manager = callFrame->argument(0).getObject())
        host->scopes.manager.set(vm, host, manager);
    return JSValue::encode(jsUndefined());
}

// Adds what the program in src/lint/js_plugin/worker calls to its `native` object.
void addLintScopeFunctions(JSGlobalObject* globalObject, JSObject* native)
{
    addLintFunction(globalObject, native, "scopes"_s, 3, jsLintScopes);
    addLintFunction(globalObject, native, "globalVariable"_s, 2, jsLintGlobalVariable);
    addLintFunction(globalObject, native, "addLibVariables"_s, 0, jsLintAddLibVariables);
    addLintFunction(globalObject, native, "usedVariables"_s, 0, jsLintUsedVariables);
    addLintFunction(globalObject, native, "setScopeManager"_s, 1, jsLintSetScopeManager);
}

} // namespace Bun
