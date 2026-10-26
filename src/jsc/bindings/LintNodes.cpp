// Builds the objects that JavaScript lint plugins see from arrays of numbers written in Rust. One call per file.
// - ESTree nodes, from src/lint/js_plugin/ast.rs. They are plain objects with own data properties in the parser's order.
// - ESLint's CodePath and CodePathSegment, from src/lint/code_path/estree.rs.
//
// Property names are turned into Identifiers once per realm, when `shape` builds a Structure. After that every object is
// JSFinalObject::create plus putDirectOffset.

#include "root.h"

#include "LintHost.h"
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/GetterSetter.h>
#include <JavaScriptCore/JSBigInt.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGenericTypedArrayViewInlines.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/ObjectInitializationScope.h>
#include <JavaScriptCore/RegExp.h>
#include <JavaScriptCore/RegExpObject.h>
#include <JavaScriptCore/YarrFlags.h>
#include <array>

namespace Bun {
using namespace JSC;

JSArray* tryCreateFilledLintArray(VM& vm, JSGlobalObject* globalObject, unsigned length)
{
    ObjectInitializationScope initializationScope(vm);
    JSArray* array = JSArray::tryCreateUninitializedRestricted(initializationScope, globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithContiguous), length);
    for (unsigned i = 0; array && i < length; ++i)
        array->initializeIndex(initializationScope, i, jsUndefined());
    return array;
}

// `shape(prototype, keys, first, hidden = 0)` returns a template object with `keys` as inline properties, in that order.
// `first` is the value of the first key. The last `hidden` keys are what `Object.defineProperty(object, key, { value })`
// defines. They are not enumerable, writable or configurable. `listen` and `codePaths` create objects with the template's Structure.
JSC_DEFINE_HOST_FUNCTION_WITH_ATTRIBUTES(jsLintShape, __attribute__((minsize)), (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* prototype = callFrame->argument(0).getObject();
    JSArray* keys = dynamicDowncast<JSArray>(callFrame->argument(1));
    if (!prototype || !keys || !keys->length() || keys->length() > JSFinalObject::maxInlineCapacity)
        return throwVMTypeError(globalObject, scope, "Expected a prototype and keys"_s);
    unsigned count = keys->length();
    // A number that the JIT has made can be a double.
    unsigned hidden = callFrame->argument(3).isNumber() ? std::min(JSC::toUInt32(callFrame->argument(3).asNumber()), count) : 0;
    Structure* structure = JSFinalObject::createStructure(vm, globalObject, prototype, count);
    for (unsigned i = 0; i < count; ++i) {
        JSValue key = keys->getIndex(globalObject, i);
        RETURN_IF_EXCEPTION(scope, {});
        Identifier name = key.toPropertyKey(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        PropertyOffset offset;
        unsigned attributes = i < count - hidden ? 0 : PropertyAttribute::DontEnum | PropertyAttribute::ReadOnly | PropertyAttribute::DontDelete;
        structure = Structure::addPropertyTransition(vm, structure, name, attributes, offset);
        RELEASE_ASSERT(offset == static_cast<PropertyOffset>(i));
        if (attributes)
            structure->setContainsReadOnlyProperties();
    }
    JSFinalObject* object = JSFinalObject::create(vm, structure);
    object->putDirectOffset(vm, 0, callFrame->argument(2));
    for (unsigned i = 1; i < count; ++i)
        object->putDirectOffset(vm, i, jsUndefined());
    return JSValue::encode(object);
}

namespace {

// The tree as src/lint/js_plugin/ast.rs writes it: eight words, then the parts whose lengths these are.
struct LintTree {
    uint32_t count, fieldCount, listCount, stringCount;
    std::span<const uint8_t> numbers;
    std::span<const uint32_t> starts, ends, parents, fields, lists, strings;
    // The nodes whose properties are in the other order, ascending.
    std::span<const uint32_t> alternates;
    std::span<const uint8_t> types;
    // UTF-8. The strings that aren't in the text of the file.
    std::span<const uint8_t> extra;

    bool read(std::span<const uint8_t> bytes)
    {
        constexpr size_t header = 8;
        if (bytes.size() < header * 4 || reinterpret_cast<uintptr_t>(bytes.data()) % 8)
            return false;
        auto* words = reinterpret_cast<const uint32_t*>(bytes.data());
        count = words[0];
        fieldCount = words[1];
        listCount = words[2];
        stringCount = words[3];
        uint64_t numberCount = words[4], extraLength = words[5], alternateCount = words[6];
        uint64_t size = header * 4 + numberCount * 8 + (uint64_t(count) * 3 + fieldCount + listCount + stringCount + alternateCount) * 4 + count + extraLength;
        if (size > bytes.size())
            return false;
        const uint8_t* at = bytes.data() + header * 4;
        numbers = { at, static_cast<size_t>(numberCount * 8) };
        at += numberCount * 8;
        auto part = [&](size_t length) {
            std::span<const uint32_t> part { reinterpret_cast<const uint32_t*>(at), length };
            at += length * 4;
            return part;
        };
        starts = part(count);
        ends = part(count);
        parents = part(count);
        fields = part(fieldCount);
        lists = part(listCount);
        strings = part(stringCount);
        alternates = part(alternateCount);
        types = { at, count };
        extra = { at + count, static_cast<size_t>(extraLength) };
        return true;
    }
};

class LintNodeMaker {
public:
    LintNodeMaker(JSGlobalObject* globalObject, const LintTree& tree, JSArray* nodes, JSString* text)
        : m_globalObject(globalObject)
        , m_vm(globalObject->vm())
        , m_tree(tree)
        , m_nodes(nodes)
        , m_text(text)
        , m_textLength(text->length())
        , m_host(LintHost::from(globalObject))
        , m_absent(m_host->isOxlint() ? jsNull() : jsUndefined())
        , m_pattern(Identifier::fromString(m_vm, "pattern"_s))
        , m_flags(Identifier::fromString(m_vm, "flags"_s))
        , m_cooked(Identifier::fromString(m_vm, "cooked"_s))
        , m_raw(Identifier::fromString(m_vm, "raw"_s))
    {
    }

    // What a word stands for, in a node from `start` to `end`. src/lint/js_plugin/ast.rs writes the words. Empty: an exception, or
    // out of step.
    JSValue value(uint32_t word, uint32_t start, uint32_t end)
    {
        uint32_t number = word >> 4;
        switch (word & 15) {
        case 0:
            switch (number) {
            case 0:
                return m_absent;
            case 1:
                return jsNull();
            case 2:
                return jsBoolean(false);
            case 3:
                return jsBoolean(true);
            case 4:
                return slice(start, end);
            default:
                return slice(start + 1, end ? end - 1 : 0);
            }
        case 1:
            return node(number);
        case 2:
            return list(number);
        case 3: {
            if (uint64_t(number) * 2 + 1 >= m_tree.strings.size())
                return {};
            uint32_t from = m_tree.strings[2 * number], to = m_tree.strings[2 * number + 1];
            return from < 0x80000000 ? slice(from, to) : sliceOfExtra(from - 0x80000000, to);
        }
        case 4:
            return m_host->nodes.knownString(m_vm, m_host, number);
        case 5:
            return jsNumber(number);
        case 6: {
            if (uint64_t(number) * 8 + 8 > m_tree.numbers.size())
                return {};
            double result;
            memcpy(&result, m_tree.numbers.data() + size_t(number) * 8, 8);
            return jsNumber(purifyNaN(result));
        }
        case 7:
            return units(number);
        default:
            return made(word & 15, number, start, end);
        }
    }

private:
    JSValue node(uint32_t id)
    {
        return id < m_tree.count ? m_nodes->getIndexQuickly(id) : JSValue();
    }

    // `text.slice(start, end)`
    JSValue slice(uint32_t start, uint32_t end)
    {
        end = std::min(end, m_textLength);
        start = std::min(start, end);
        return jsSubstringOfResolved(m_vm, m_text, start, end - start);
    }

    // The same of the text that comes with the tree, which is rare.
    JSValue sliceOfExtra(uint32_t start, uint32_t end)
    {
        if (!m_extraText)
            m_extraText = jsString(m_vm, String::fromUTF8ReplacingInvalidSequences(byteCast<char8_t>(m_tree.extra)));
        end = std::min(end, m_extraText->length());
        start = std::min(start, end);
        return jsSubstringOfResolved(m_vm, m_extraText, start, end - start);
    }

    // A string from the list of its UTF-16 code units: it has half of a surrogate pair.
    JSValue units(uint32_t at)
    {
        if (at >= m_tree.lists.size() || m_tree.lists[at] >= m_tree.lists.size() - at)
            return {};
        auto list = m_tree.lists.subspan(at + 1, m_tree.lists[at]);
        Vector<char16_t, 64> units(list.size(), [&](size_t i) { return static_cast<char16_t>(list[i]); });
        return jsString(m_vm, String(units.span()));
    }

    // What is made of the one or two words at `at` in the lists.
    JSValue made(uint32_t tag, uint32_t at, uint32_t start, uint32_t end)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        bool isBigInt = tag > 10;
        if (uint64_t(at) + (isBigInt ? 0 : 1) >= m_tree.lists.size())
            return {};
        JSValue first = value(m_tree.lists[at], start, end);
        RETURN_IF_EXCEPTION(scope, {});
        JSValue second = isBigInt ? jsUndefined() : value(m_tree.lists[at + 1], start, end);
        RETURN_IF_EXCEPTION(scope, {});
        if (!first || !second)
            return {};
        if (tag == 9 || tag == 10) {
            // acorn and oxlint have `{ pattern, flags }` and `{ raw, cooked }`. typescript-estree has both by name.
            auto kind = m_host->nodes.kindFor(m_host->isEspree(), m_host->isOxlint(), m_host->shortensNodes());
            bool secondIsFirst = tag == 9 ? kind == LintNodeState::TypeScript : kind >= LintNodeState::Espree;
            JSObject* object = constructEmptyObject(m_globalObject);
            if (secondIsFirst)
                object->putDirect(m_vm, tag == 9 ? m_flags : m_raw, second);
            object->putDirect(m_vm, tag == 9 ? m_pattern : m_cooked, first);
            if (!secondIsFirst)
                object->putDirect(m_vm, tag == 9 ? m_flags : m_raw, second);
            return object;
        }
        if (!first.isString() || !(isBigInt || second.isString()))
            return {};
        auto text = asString(first)->value(m_globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        if (isBigInt) {
            JSValue result = JSBigInt::stringToBigInt(m_globalObject, text.data);
            RETURN_IF_EXCEPTION(scope, {});
            return result;
        }
        // `value` of a regular expression is `null` where the engine can't make it.
        auto flagsText = asString(second)->value(m_globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        auto flags = Yarr::parseFlags(flagsText.data);
        if (!flags)
            return jsNull();
        RegExp* regExp = RegExp::create(m_vm, text.data, *flags);
        if (!regExp->isValid())
            return jsNull();
        return RegExpObject::create(m_vm, m_globalObject->regExpStructure(), regExp);
    }

    JSValue list(uint32_t at)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        if (at >= m_tree.lists.size() || m_tree.lists[at] >= m_tree.lists.size() - at)
            return {};
        uint32_t length = m_tree.lists[at];
        MarkedArgumentBuffer items;
        items.ensureCapacity(length);
        for (uint32_t i = 1; i <= length; ++i) {
            uint32_t id = m_tree.lists[at + i];
            JSValue item = id ? node(id) : jsNull();
            if (!item)
                return {};
            items.append(item);
        }
        if (items.hasOverflowed()) [[unlikely]] {
            throwOutOfMemoryError(m_globalObject, scope);
            return {};
        }
        JSArray* result = constructArray(m_globalObject, static_cast<ArrayAllocationProfile*>(nullptr), items);
        RETURN_IF_EXCEPTION(scope, {});
        return result;
    }

    JSGlobalObject* m_globalObject;
    VM& m_vm;
    const LintTree& m_tree;
    JSArray* m_nodes;
    JSString* m_text;
    uint32_t m_textLength;
    LintHost* m_host;
    // What a field has that there's nothing to say about. oxlint has no `undefined` in a node.
    JSValue m_absent;
    JSString* m_extraText { nullptr };
    Identifier m_pattern, m_flags, m_cooked, m_raw;
};

} // namespace

// What's in a property that is `[]` in every node of a type, until it's read. To a plugin it's a plain property all along, and each
// node has an array of its own. Few rules read `decorators` of an `Identifier`, and a third of all nodes are `Identifier`s.
JSC_DEFINE_CUSTOM_GETTER(lintLazyEmptyList, (JSGlobalObject*, EncodedJSValue thisValue, PropertyName name))
{
    JSGlobalObject* globalObject = LintHost::realmOfHolder(thisValue);
    if (!globalObject) [[unlikely]]
        return JSValue::encode(jsUndefined());
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSArray* list = tryCreateFilledLintArray(vm, globalObject, 0);
    if (!list) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    lintReplaceCustomValue(vm, LintHost::from(globalObject), asObject(JSValue::decode(thisValue)), name, list);
    return JSValue::encode(list);
}

JSC_DEFINE_HOST_FUNCTION(jsLintIllegalConstructor, (JSGlobalObject * globalObject, CallFrame*))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    return throwVMTypeError(globalObject, scope, "Illegal constructor"_s);
}

__attribute__((minsize)) bool LintNodeState::load(JSGlobalObject* globalObject, LintHost* host)
{
    constexpr uint32_t layouts = 15;
    LintSpan answer = Bun__Lint__ask(globalObject, layouts, nullptr, 0);
    if (answer.len < 12 || reinterpret_cast<uintptr_t>(answer.ptr) % 4)
        return false;
    Vector<uint32_t> words;
    words.fill(0, (answer.len + 3) / 4);
    memcpy(words.mutableSpan().data(), answer.ptr, answer.len);
    uint32_t typeCount = words[0], stringCount = words[1], wordCount = words[2];
    if (answer.len < 20 || words[3] != layoutKinds || typeCount > 256 || wordCount > answer.len / 4)
        return false;
    uint32_t orderLength = words[4];
    if (uint64_t(stringCount) + orderLength > wordCount)
        return false;
    std::span<const Latin1Character> names { reinterpret_cast<const Latin1Character*>(words.span().data() + wordCount), answer.len - size_t(wordCount) * 4 };
    auto isName = [&](uint32_t reference) { return (reference >> 8) + (reference & 255) <= names.size(); };

    std::array<Vector<Layout>, layoutKinds> byKind;
    Vector<uint32_t> typeNames;
    uint32_t templateCount = 0;
    size_t at = 5, end = wordCount - stringCount - orderLength;
    for (uint32_t type = 0; type < typeCount; ++type) {
        if (at >= end || !isName(words[at]))
            return false;
        typeNames.append(words[at++]);
        for (auto& list : byKind) {
            if (end - at < 5)
                return false;
            Layout layout { words[at], words[at + 1], words[at + 2], {}, {}, templateCount };
            std::array<size_t, 2> lengths { size_t(words[at + 3]) * 2, size_t(words[at + 4]) * 2 };
            at += 5;
            if (layout.fieldCount > 32 || std::popcount(layout.leftOut) > 4)
                return false;
            for (unsigned order = 0; order < 2; ++order) {
                size_t length = lengths[order];
                if (length > end - at || length / 2 > JSFinalObject::maxInlineCapacity)
                    return false;
                auto properties = words.span().subspan(at, length);
                bool hasParent = false;
                for (size_t i = 0; i < length; i += 2) {
                    uint32_t what = properties[i + 1];
                    if (!isName(properties[i]) || (what >= layout.fieldCount && (what < What::Type || what > What::Value)))
                        return false;
                    hasParent |= what == What::Parent;
                }
                if (length && !hasParent)
                    return false;
                (order ? layout.alternate : layout.properties) = properties;
                at += length;
            }
            if (layout.properties.empty())
                return false;
            templateCount += (layout.alternate.empty() ? 1u : 2u) << std::popcount(layout.leftOut);
            list.append(layout);
        }
    }
    if (at != end)
        return false;
    for (uint32_t reference : words.span().subspan(end, stringCount)) {
        if (!isName(reference))
            return false;
    }
    std::array<std::span<const uint32_t>, visitorKeyKinds> orders;
    auto orderWords = words.span().subspan(end + stringCount, orderLength);
    for (auto& order : orders) {
        if (orderWords.empty() || size_t(orderWords[0]) * 2 > orderWords.size() - 1)
            return false;
        order = orderWords.subspan(1, size_t(orderWords[0]) * 2);
        orderWords = orderWords.subspan(1 + order.size());
        for (size_t i = 0; i < order.size(); i += 2) {
            if (!isName(order[i]) || (order[i + 1] >= typeCount && UINT32_MAX - order[i + 1] >= keysOfOtherTypes.size()))
                return false;
        }
    }

    // The collector can be looking at the host.
    Locker locker { host->cellLock() };
    m_words = WTF::move(words);
    m_names = names;
    m_knownStringNames = m_words.span().subspan(end, stringCount);
    m_typeNameReferences = WTF::move(typeNames);
    m_layouts = WTF::move(byKind);
    m_visitorKeyOrders = orders;
    m_templates.grow(templateCount);
    m_plans.grow(templateCount);
    m_typeNames.grow(typeCount);
    m_knownStrings.grow(stringCount);
    return true;
}

JSString* LintNodeState::typeName(VM& vm, LintHost* host, uint8_t type)
{
    auto& slot = m_typeNames[type];
    if (!slot) [[unlikely]]
        slot.set(vm, host, jsOwnedString(vm, AtomString(name(m_typeNameReferences[type]))));
    return slot.get();
}

JSString* LintNodeState::knownString(VM& vm, LintHost* host, uint32_t index)
{
    if (index >= m_knownStrings.size()) [[unlikely]]
        return nullptr;
    auto& slot = m_knownStrings[index];
    if (!slot) [[unlikely]]
        slot.set(vm, host, jsOwnedString(vm, AtomString(name(m_knownStringNames[index]))));
    return slot.get();
}

__attribute__((minsize)) JSObject* LintNodeState::prototype(VM& vm, JSGlobalObject* globalObject, LintHost* host, LayoutKind kind)
{
    if (kind == TypeScript)
        return globalObject->objectPrototype();
    auto& slot = m_sharedPrototypes[kind == OxlintJavaScript ? Oxlint : kind];
    if (slot)
        return slot.get();
    JSObject* prototype = constructEmptyObject(globalObject);
    slot.set(vm, host, prototype);
    if (kind == Espree) {
        // acorn's `class Node`, for `constructor.name` and `instanceof`.
        JSFunction* constructor = JSFunction::create(vm, globalObject, 3, "Node"_s, jsLintIllegalConstructor, ImplementationVisibility::Public, NoIntrinsic, jsLintIllegalConstructor);
        constructor->putDirect(vm, vm.propertyNames->prototype, prototype, PropertyAttribute::DontEnum | PropertyAttribute::DontDelete);
        prototype->putDirect(vm, vm.propertyNames->constructor, constructor, static_cast<unsigned>(PropertyAttribute::DontEnum));
    } else {
        // oxlint's `get loc()`
        GetterSetter* loc = GetterSetter::create(vm, globalObject, host->sourceCode.locGetter.get(), nullptr);
        prototype->putDirectNonIndexAccessor(vm, Identifier::fromString(vm, "loc"_s), loc, PropertyAttribute::Accessor | PropertyAttribute::DontDelete);
    }
    return prototype;
}

__attribute__((minsize)) JSObject* LintNodeState::makeTemplate(JSGlobalObject* globalObject, LintHost* host, LayoutKind kind, uint8_t type, unsigned which, bool isAlternate, unsigned index)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    const Layout& layout = m_layouts[kind][type];
    auto properties = isAlternate ? layout.alternate : layout.properties;
    // Whether the nodes have the property that `what` is in.
    auto has = [&](uint32_t what) {
        if (what >= What::Type || !(layout.leftOut >> what & 1))
            return true;
        return (which >> std::popcount(layout.leftOut & ((1u << what) - 1)) & 1) != 0;
    };
    unsigned count = 0;
    for (size_t i = 0; i < properties.size(); i += 2)
        count += has(properties[i + 1]);
    // It's made the way a plugin could make it, so that the Structure knows about what isn't a plain property.
    JSFinalObject* like = JSFinalObject::create(vm, JSFinalObject::createStructure(vm, globalObject, prototype(vm, globalObject, host, kind), count));
    m_templates[index].set(vm, host, like);
    Plan& plan = m_plans[index];
    uint8_t offset = 0;
    for (size_t i = 0; i < properties.size(); i += 2) {
        uint32_t what = properties[i + 1];
        if (!has(what))
            continue;
        if (what < What::Type || what == What::Start || what == What::End || what == What::Range)
            plan.own.append(std::pair<uint8_t, uint8_t> { offset, static_cast<uint8_t>(what) });
        else
            plan.same.append(offset);
        if (what == What::Parent)
            plan.parent = offset;
        ++offset;
        Identifier key = Identifier::fromString(vm, AtomString(name(properties[i])));
        if (what == What::Loc) {
            // As in a token: a plain property to a plugin, which is computed from `range` when it's first read.
            like->putDirectCustomAccessor(vm, key, host->sourceCode.lazyLocOfNode.get(), static_cast<unsigned>(PropertyAttribute::CustomValue));
        } else if (what == What::Comments || what == What::Tokens) {
            for (auto& list : host->tokens.listsOfProgram) {
                if (list.name != key)
                    continue;
                if (kind >= Oxlint)
                    like->putDirectNonIndexAccessor(vm, key, list.getter.get(), static_cast<unsigned>(PropertyAttribute::Accessor));
                else
                    like->putDirectCustomAccessor(vm, key, list.customValue.get(), static_cast<unsigned>(PropertyAttribute::CustomValue));
            }
        } else if (what == What::Deprecated) {
            JSValue pair = deprecated->get(globalObject, Identifier::fromString(vm, makeString(StringView(name(m_typeNameReferences[type])), '.', StringView(name(properties[i])))));
            RETURN_IF_EXCEPTION(scope, nullptr);
            JSValue getter = lintGetIndex(globalObject, pair, 0);
            RETURN_IF_EXCEPTION(scope, nullptr);
            JSValue setter = lintGetIndex(globalObject, pair, 1);
            RETURN_IF_EXCEPTION(scope, nullptr);
            if (!getter.isCallable() || !setter.isCallable()) {
                throwTypeError(globalObject, scope, "Expected a getter and a setter"_s);
                return nullptr;
            }
            like->putDirectNonIndexAccessor(vm, key, GetterSetter::create(vm, globalObject, asObject(getter), asObject(setter)), PropertyAttribute::Accessor | PropertyAttribute::DontEnum);
        } else if (what == What::EmptyList) {
            if (!m_lazyEmptyList)
                m_lazyEmptyList.set(vm, host, CustomGetterSetter::create(vm, lintLazyEmptyList, nullptr));
            like->putDirectCustomAccessor(vm, key, m_lazyEmptyList.get(), static_cast<unsigned>(PropertyAttribute::CustomValue));
        } else {
            JSValue same = kind >= Oxlint || what == What::Parent ? jsNull() : jsUndefined();
            if (what == What::Type)
                same = typeName(vm, host, type);
            else if (what == What::False)
                same = jsBoolean(false);
            else if (what == What::Value)
                same = jsOwnedString(vm, AtomString("value"_s));
            like->putDirect(vm, key, same);
        }
    }
    RELEASE_ASSERT(like->structure()->maxOffset() == static_cast<PropertyOffset>(count) - 1);
    return like;
}

__attribute__((minsize)) JSObject* LintNodeState::visitorKeys(JSGlobalObject* globalObject, LintHost* host, LayoutKind kind)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (kind == OxlintJavaScript)
        kind = Oxlint;
    if (JSObject* made = m_visitorKeys[kind].get())
        return made;
    JSObject* all = constructEmptyObject(globalObject);
    m_visitorKeys[kind].set(vm, host, all);
    auto add = [&](uint32_t typeName, uint32_t type) {
        MarkedArgumentBuffer keys;
        if (type >= typeCount()) {
            for (StringView key : StringView(keysOfOtherTypes[UINT32_MAX - type]).split(' '))
                keys.append(jsOwnedString(vm, AtomString(key.span8())));
        } else {
            // oxlint has the keys of typescript-estree.
            const Layout& layout = m_layouts[kind == Espree ? Espree : TypeScript][type];
            // In the order of the fields, which is the order of the traversal.
            for (uint32_t field = 0; field < layout.fieldCount; ++field) {
                if (!(layout.visitorKeys >> field & 1))
                    continue;
                for (size_t i = 0; i < layout.properties.size(); i += 2) {
                    if (layout.properties[i + 1] == field)
                        keys.append(jsOwnedString(vm, AtomString(name(layout.properties[i]))));
                }
            }
        }
        JSObject* list = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), keys);
        RETURN_IF_EXCEPTION(scope, void());
        objectConstructorFreeze(globalObject, list);
        RETURN_IF_EXCEPTION(scope, void());
        all->putDirect(vm, Identifier::fromString(vm, AtomString(name(typeName))), list);
    };
    auto order = m_visitorKeyOrders[kind];
    for (size_t i = 0; i < order.size(); i += 2) {
        add(order[i], order[i + 1]);
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    objectConstructorFreeze(globalObject, all);
    RETURN_IF_EXCEPTION(scope, nullptr);
    return all;
}

std::optional<uint8_t> LintNodeState::typeNamed(const String& wanted) const
{
    for (size_t type = 0; type < m_typeNameReferences.size(); ++type) {
        if (wanted == StringView(name(m_typeNameReferences[type])))
            return static_cast<uint8_t>(type);
    }
    return std::nullopt;
}

// The nodes of the tree in `bytes`, by their number, as the layouts of the host say. Null: an exception was thrown. Rust keeps `bytes`
// until the file is done.
static JSArray* makeLintNodes(JSGlobalObject* globalObject, LintHost* host, std::span<const uint8_t> bytes)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto outOfStep = [&]() -> JSArray* {
        throwTypeError(globalObject, scope, "The tree is not as expected"_s);
        return nullptr;
    };
    using What = LintNodeState::What;

    LintNodeState& state = host->nodes;
    LintTree tree;
    if (!state.isLoaded() || !tree.read(bytes))
        return outOfStep();
    uint32_t count = tree.count;
    auto kind = state.kindFor(host->isEspree(), host->isOxlint(), host->shortensNodes());

    // Where the words of each node start.
    Vector<uint32_t> offsets(count);
    uint64_t at = 0;
    for (uint32_t id = 0; id < count; ++id) {
        uint8_t type = tree.types[id];
        if (type >= state.typeCount() || tree.parents[id] >= count)
            return outOfStep();
        offsets[id] = static_cast<uint32_t>(at);
        at += state.layout(kind, type).fieldCount;
    }
    if (at > tree.fields.size())
        return outOfStep();

    JSArray* nodes = tryCreateFilledLintArray(vm, globalObject, count);
    if (!nodes) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return nullptr;
    }
    Structure* rangeStructure = globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithInt32);
    LintNodeMaker maker(globalObject, tree, nodes, host->text());
    // Where each node has `parent`.
    Vector<uint8_t> parentOffsets(count);
    size_t alternatesLeft = tree.alternates.size();

    // What is in a node has a higher number.
    for (uint32_t id = count; id--;) {
        uint8_t type = tree.types[id];
        const auto& layout = state.layout(kind, type);
        const uint32_t* words = tree.fields.data() + offsets[id];
        uint32_t start = tree.starts[id], end = tree.ends[id];
        unsigned which = 0;
        if (layout.leftOut) [[unlikely]] {
            unsigned bit = 0;
            for (uint32_t i = 0; i < layout.fieldCount; ++i) {
                if (layout.leftOut >> i & 1)
                    which |= (words[i] ? 1u : 0u) << bit++;
            }
        }
        bool isAlternate = alternatesLeft && tree.alternates[alternatesLeft - 1] == id;
        alternatesLeft -= isAlternate;
        isAlternate &= !layout.alternate.empty();
        auto [like, plan] = state.templateFor(globalObject, host, kind, type, which, isAlternate);
        RETURN_IF_EXCEPTION(scope, nullptr);
        JSFinalObject* node = JSFinalObject::create(vm, like->structure());
        nodes->setIndexQuickly(vm, id, node);
        parentOffsets[id] = plan->parent;
        for (uint8_t offset : plan->same)
            node->putDirectOffset(vm, offset, like->getDirect(offset));
        for (auto [offset, what] : plan->own) {
            JSValue value;
            if (what < What::Type) [[likely]] {
                value = maker.value(words[what], start, end);
                RETURN_IF_EXCEPTION(scope, nullptr);
                if (!value) [[unlikely]]
                    return outOfStep();
            } else if (what == What::Start)
                value = jsNumber(start);
            else if (what == What::End)
                value = jsNumber(end);
            else {
                ObjectInitializationScope initializationScope(vm);
                JSArray* range = JSArray::tryCreateUninitializedRestricted(initializationScope, rangeStructure, 2);
                if (!range) [[unlikely]] {
                    throwOutOfMemoryError(globalObject, scope);
                    return nullptr;
                }
                range->initializeIndex(initializationScope, 0, jsNumber(start));
                range->initializeIndex(initializationScope, 1, jsNumber(end));
                value = range;
            }
            node->putDirectOffset(vm, offset, value);
        }
    }
    for (uint32_t id = 1; id < count; ++id)
        asObject(nodes->getIndexQuickly(id))->putDirectOffset(vm, parentOffsets[id], nodes->getIndexQuickly(tree.parents[id]));
    host->sourceCode.setTree(vm, host, nodes, tree.starts, tree.ends, tree.parents);
    return nodes;
}

// `defineNodes(deprecated)` is called once, while something is handled. `deprecated`: by `Type.property`, a getter and a setter for the
// deprecated properties of typescript-estree.
JSC_DEFINE_HOST_FUNCTION(jsLintDefineNodes, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintHost* host = LintHost::from(globalObject);
    JSObject* deprecated = callFrame->argument(0).getObject();
    if (!deprecated || host->nodes.isLoaded() || !host->nodes.load(globalObject, host))
        return throwVMTypeError(globalObject, scope, "The layouts are not as expected"_s);
    host->nodes.deprecated.set(vm, host, deprecated);
    return JSValue::encode(jsUndefined());
}

// `typeId(name)`: the number of the type of nodes that is called `name`, or `undefined`.
JSC_DEFINE_HOST_FUNCTION(jsLintTypeId, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue name = callFrame->argument(0);
    if (!name.isString())
        return JSValue::encode(jsUndefined());
    auto text = asString(name)->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto type = LintHost::from(globalObject)->nodes.typeNamed(text.data);
    return JSValue::encode(type ? jsNumber(*type) : jsUndefined());
}

// `visitorKeys(kind)`: `sourceCode.visitorKeys` with typescript-estree (0), espree (1) or oxlint (2). The same object each time.
JSC_DEFINE_HOST_FUNCTION(jsLintVisitorKeys, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    LintHost* host = LintHost::from(globalObject);
    // A number that the JIT has made can be a double.
    uint32_t kind = callFrame->argument(0).isNumber() ? JSC::toUInt32(callFrame->argument(0).asNumber()) : 0;
    if (kind >= LintNodeState::visitorKeyKinds || !host->nodes.isLoaded())
        return throwVMTypeError(globalObject, scope, "The layouts are not as expected"_s);
    JSObject* keys = host->nodes.visitorKeys(globalObject, host, static_cast<LintNodeState::LayoutKind>(kind));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(keys);
}

// `listen(words, length)` tells Rust what the rules listen for in the file that's being linted: the
// first `length` of `words`, a `Uint32Array`, as `LISTEN` in src/lint/js_plugin/wire.rs describes them.
// Returns `[calls, nodes]`. `calls`: a `Uint32Array`, see src/lint/js_plugin/calls.rs. `nodes`: those of the file by their number,
// or `undefined` if the tree didn't come.
JSC_DEFINE_HOST_FUNCTION(jsLintListen, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto outOfStep = [&] { return throwVMTypeError(globalObject, scope, "The calls are not as expected"_s); };
    constexpr uint32_t listen = 14;

    auto* words = dynamicDowncast<JSUint32Array>(callFrame->argument(0));
    JSValue length = callFrame->argument(1);
    LintHost* host = LintHost::from(globalObject);
    if (!words || words->isDetached() || !length.isNumber() || !host->isLinting())
        return outOfStep();
    auto details = words->typedSpan().first(std::min<size_t>(words->length(), JSC::toUInt32(length.asNumber())));
    LintSpan answer = Bun__Lint__ask(globalObject, listen, reinterpret_cast<const uint8_t*>(details.data()), details.size_bytes());
    std::span<const uint8_t> bytes { answer.ptr, answer.len };
    if (bytes.size() < 8 || reinterpret_cast<uintptr_t>(bytes.data()) % 8)
        return outOfStep();
    auto* header = reinterpret_cast<const uint32_t*>(bytes.data());
    uint64_t callBytes = uint64_t(header[0]) * 4, treeBytes = header[1];
    if (header[0] % 2 || 8 + callBytes + treeBytes != bytes.size())
        return outOfStep();

    JSArray* result = tryCreateFilledLintArray(vm, globalObject, 2);
    if (!result) [[unlikely]]
        return JSValue::encode(throwOutOfMemoryError(globalObject, scope));
    auto* calls = JSUint32Array::createUninitialized(globalObject, globalObject->typedArrayStructureWithTypedArrayType<TypeUint32>(), header[0]);
    RETURN_IF_EXCEPTION(scope, {});
    memcpy(calls->typedVector(), header + 2, callBytes);
    result->setIndexQuickly(vm, 0, calls);
    if (treeBytes) {
        JSArray* nodes = makeLintNodes(globalObject, host, bytes.subspan(8 + callBytes));
        RETURN_IF_EXCEPTION(scope, {});
        // A copy. The host relies on its own list, and a plugin that has changed `Array.prototype` can get at what the program has.
        ObjectInitializationScope initializationScope(vm);
        JSArray* copy = JSArray::tryCreateUninitializedRestricted(initializationScope, globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithContiguous), nodes->length());
        if (!copy) [[unlikely]]
            return JSValue::encode(throwOutOfMemoryError(globalObject, scope));
        for (unsigned i = 0; i < nodes->length(); ++i)
            copy->initializeIndex(initializationScope, i, nodes->getIndexQuickly(i));
        result->setIndexQuickly(vm, 1, copy);
    }
    return JSValue::encode(result);
}

namespace {

// The message from `analyze` in src/lint/code_path/estree.rs, which documents the layout.
struct LintCodePaths {
    static constexpr size_t headerWords = 4, eventWords = 4, pathWords = 7, segmentWords = 8;
    static constexpr uint32_t reachable = 1, used = 2;

    uint32_t pathCount, segmentCount;
    std::span<const uint32_t> events, paths, segments, lists;

    bool isUsed(uint32_t segment) const { return segment < segmentCount && segments[segment * segmentWords + 2] & used; }

    // Checks a list of segments, or of code paths if `ofPaths`.
    bool isList(uint32_t at, bool ofPaths) const
    {
        if (at >= lists.size() || lists[at] >= lists.size() - at)
            return false;
        for (uint32_t item : lists.subspan(at + 1, lists[at])) {
            if (ofPaths ? item >= pathCount : !isUsed(item))
                return false;
        }
        return true;
    }

    // Checks every length and index, so that nothing has to be checked while the objects are built.
    bool read(std::span<const uint8_t> bytes, uint32_t originCount)
    {
        if (bytes.size() < headerWords * 4 || reinterpret_cast<uintptr_t>(bytes.data()) % 4)
            return false;
        std::span<const uint32_t> words { reinterpret_cast<const uint32_t*>(bytes.data()), bytes.size() / 4 };
        uint64_t eventCount = words[0], listLength = words[3];
        pathCount = words[1];
        segmentCount = words[2];
        uint64_t pathsAt = headerWords + eventCount * eventWords;
        uint64_t segmentsAt = pathsAt + uint64_t(pathCount) * pathWords;
        uint64_t listsAt = segmentsAt + uint64_t(segmentCount) * segmentWords;
        if (listsAt + listLength > words.size())
            return false;
        events = words.subspan(headerWords, eventCount * eventWords);
        paths = words.subspan(pathsAt, size_t(pathCount) * pathWords);
        segments = words.subspan(segmentsAt, size_t(segmentCount) * segmentWords);
        lists = words.subspan(listsAt, listLength);
        for (uint32_t i = 0; i < pathCount; ++i) {
            auto path = paths.subspan(size_t(i) * pathWords, pathWords);
            if (path[0] >= originCount || path[1] > pathCount || !isUsed(path[2]))
                return false;
            if (!isList(path[3], false) || !isList(path[4], false) || !isList(path[5], false) || !isList(path[6], true))
                return false;
        }
        for (uint32_t i = 0; i < segmentCount; ++i) {
            auto segment = segments.subspan(size_t(i) * segmentWords, segmentWords);
            if (!(segment[2] & used))
                continue;
            if (segment[0] >= pathCount)
                return false;
            for (size_t list = 3; list < segmentWords; ++list) {
                if (!isList(segment[list], false))
                    return false;
            }
        }
        return true;
    }
};

} // namespace

// `codePaths(shapes, origins)` asks Rust for the code paths of the file that's being linted and returns `[codePaths, segments, events]`.
// The first two are indexed as in the message. `events`: a `Uint32Array` with the four words of each event.
// A segment that never became current isn't part of any graph, so its index stays a hole.
// `shapes` holds four templates from `shape`, for a CodePath, its `internal`, a CodePathSegment and its `internal`.
// `origins` holds the strings for `codePath.origin`.
JSC_DEFINE_HOST_FUNCTION(jsLintCodePaths, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto outOfStep = [&] { return throwVMTypeError(globalObject, scope, "The code paths are not as expected"_s); };
    auto outOfMemory = [&] {
        throwOutOfMemoryError(globalObject, scope);
        return EncodedJSValue {};
    };

    JSArray* shapes = dynamicDowncast<JSArray>(callFrame->argument(0));
    JSArray* origins = dynamicDowncast<JSArray>(callFrame->argument(1));
    if (!shapes || !origins || !LintHost::from(globalObject)->isLinting())
        return outOfStep();
    constexpr uint32_t codePathsOfFile = 11;
    LintSpan answer = Bun__Lint__ask(globalObject, codePathsOfFile, nullptr, 0);
    std::span<const uint8_t> bytes { answer.ptr, answer.len };

    // How many properties each template has.
    constexpr std::array<PropertyOffset, 4> sizes { 5, 4, 7, 2 };
    std::array<Structure*, 4> structures;
    for (unsigned i = 0; i < sizes.size(); ++i) {
        JSValue shape = shapes->getIndex(globalObject, i);
        RETURN_IF_EXCEPTION(scope, {});
        auto* object = dynamicDowncast<JSFinalObject>(shape);
        if (!object || object->structure()->maxOffset() != sizes[i] - 1)
            return outOfStep();
        structures[i] = object->structure();
    }
    auto [pathStructure, pathInternalStructure, segmentStructure, segmentInternalStructure] = structures;

    MarkedArgumentBuffer originStrings;
    for (unsigned i = 0; i < origins->length(); ++i) {
        JSValue origin = origins->getIndex(globalObject, i);
        RETURN_IF_EXCEPTION(scope, {});
        originStrings.append(origin);
    }
    if (originStrings.hasOverflowed()) [[unlikely]]
        return outOfMemory();

    LintCodePaths message;
    if (!message.read(bytes, originStrings.size()))
        return outOfStep();

    // Everything below is reachable from `result` as soon as it exists.
    Structure* arrayStructure = globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithContiguous);
    JSArray* result = tryCreateFilledLintArray(vm, globalObject, 3);
    if (!result) [[unlikely]]
        return outOfMemory();
    auto* events = JSUint32Array::createUninitialized(globalObject, globalObject->typedArrayStructureWithTypedArrayType<TypeUint32>(), message.events.size());
    RETURN_IF_EXCEPTION(scope, {});
    memcpy(events->typedVector(), message.events.data(), message.events.size_bytes());
    result->setIndexQuickly(vm, 2, events);
    JSArray* paths = tryCreateFilledLintArray(vm, globalObject, message.pathCount);
    if (!paths) [[unlikely]]
        return outOfMemory();
    result->setIndexQuickly(vm, 0, paths);
    JSArray* segments = tryCreateFilledLintArray(vm, globalObject, message.segmentCount);
    if (!segments) [[unlikely]]
        return outOfMemory();
    result->setIndexQuickly(vm, 1, segments);

    // The graphs have cycles, so all cells come first and the links second.
    for (uint32_t i = 0; i < message.pathCount; ++i)
        paths->setIndexQuickly(vm, i, JSFinalObject::create(vm, pathStructure));
    for (uint32_t i = 0; i < message.segmentCount; ++i) {
        if (message.isUsed(i))
            segments->setIndexQuickly(vm, i, JSFinalObject::create(vm, segmentStructure));
    }

    // Puts the list at `at` into a property of `object`. Returns false if there's no memory.
    auto putList = [&](JSObject* object, PropertyOffset offset, uint32_t at, JSArray* from) {
        auto items = message.lists.subspan(at + 1, message.lists[at]);
        JSArray* list;
        {
            ObjectInitializationScope initializationScope(vm);
            list = JSArray::tryCreateUninitializedRestricted(initializationScope, arrayStructure, items.size());
            if (!list) [[unlikely]]
                return false;
            for (unsigned i = 0; i < items.size(); ++i)
                list->initializeIndex(initializationScope, i, from->getIndexQuickly(items[i]));
        }
        object->putDirectOffset(vm, offset, list);
        return true;
    };

    for (uint32_t i = 0; i < message.pathCount; ++i) {
        auto words = message.paths.subspan(size_t(i) * LintCodePaths::pathWords, LintCodePaths::pathWords);
        JSObject* path = asObject(paths->getIndexQuickly(i));
        path->putDirectOffset(vm, 0, jsNontrivialString(vm, makeString('s', i + 1)));
        path->putDirectOffset(vm, 1, originStrings.at(words[0]));
        path->putDirectOffset(vm, 2, words[1] ? paths->getIndexQuickly(words[1] - 1) : jsNull());
        JSObject* internal = JSFinalObject::create(vm, pathInternalStructure);
        path->putDirectOffset(vm, 4, internal);
        internal->putDirectOffset(vm, 0, segments->getIndexQuickly(words[2]));
        if (!putList(path, 3, words[6], paths) || !putList(internal, 1, words[3], segments) || !putList(internal, 2, words[4], segments) || !putList(internal, 3, words[5], segments)) [[unlikely]]
            return outOfMemory();
    }
    for (uint32_t i = 0; i < message.segmentCount; ++i) {
        if (!message.isUsed(i))
            continue;
        auto words = message.segments.subspan(size_t(i) * LintCodePaths::segmentWords, LintCodePaths::segmentWords);
        JSObject* segment = asObject(segments->getIndexQuickly(i));
        segment->putDirectOffset(vm, 0, jsNontrivialString(vm, makeString('s', words[0] + 1, '_', words[1])));
        segment->putDirectOffset(vm, 5, jsBoolean(words[2] & LintCodePaths::reachable));
        JSObject* internal = JSFinalObject::create(vm, segmentInternalStructure);
        segment->putDirectOffset(vm, 6, internal);
        internal->putDirectOffset(vm, 0, jsBoolean(true));
        if (!putList(segment, 1, words[3], segments) || !putList(segment, 2, words[4], segments) || !putList(segment, 3, words[5], segments) || !putList(segment, 4, words[6], segments) || !putList(internal, 1, words[7], segments)) [[unlikely]]
            return outOfMemory();
    }
    return JSValue::encode(result);
}

// LintAsk.cpp
void addLintAskFunctions(JSGlobalObject*, JSObject* native);
// LintScopes.cpp
void addLintScopeFunctions(JSGlobalObject*, JSObject* native);

// `{ shape, listen, codePaths, .. }` for the program in src/lint/js_plugin/worker.
extern "C" EncodedJSValue Bun__Lint__nodeFunctions(JSGlobalObject* globalObject)
{
    JSObject* object = constructEmptyObject(globalObject);
    addLintFunction(globalObject, object, "shape"_s, 4, jsLintShape);
    addLintFunction(globalObject, object, "listen"_s, 2, jsLintListen);
    addLintFunction(globalObject, object, "defineNodes"_s, 1, jsLintDefineNodes);
    addLintFunction(globalObject, object, "typeId"_s, 1, jsLintTypeId);
    addLintFunction(globalObject, object, "visitorKeys"_s, 1, jsLintVisitorKeys);
    addLintFunction(globalObject, object, "codePaths"_s, 2, jsLintCodePaths);
    addLintHostFunctions(globalObject, object);
    addLintAskFunctions(globalObject, object);
    addLintScopeFunctions(globalObject, object);
    return JSValue::encode(object);
}

} // namespace Bun
