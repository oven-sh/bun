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
#include <JavaScriptCore/JSArrayBuffer.h>
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

// An array of `length` times `undefined`, or null if there's no memory. `setIndexQuickly` is safe for all its indices.
// It isn't after `JSArray::tryCreate`, which makes room for a few items only once a plugin has put an accessor with an index for
// a name on `Array.prototype`.
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
JSC_DEFINE_HOST_FUNCTION(jsLintShape, (JSGlobalObject * globalObject, CallFrame* callFrame))
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

// The tree as src/lint/js_plugin/ast.rs writes it: six words, then the parts whose lengths these are.
struct LintTree {
    uint32_t count, fieldCount, listCount, stringCount;
    std::span<const uint8_t> numbers;
    std::span<const uint32_t> starts, ends, parents, fields, lists, strings;
    std::span<const uint8_t> types;
    // UTF-8. The strings that aren't in the text of the file.
    std::span<const uint8_t> extra;

    bool read(std::span<const uint8_t> bytes)
    {
        constexpr size_t header = 6;
        if (bytes.size() < header * 4 || reinterpret_cast<uintptr_t>(bytes.data()) % 8)
            return false;
        auto* words = reinterpret_cast<const uint32_t*>(bytes.data());
        count = words[0];
        fieldCount = words[1];
        listCount = words[2];
        stringCount = words[3];
        uint64_t numberCount = words[4], extraLength = words[5];
        uint64_t size = header * 4 + numberCount * 8 + (uint64_t(count) * 3 + fieldCount + listCount + stringCount) * 4 + count + extraLength;
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
        types = { at, count };
        extra = { at + count, static_cast<size_t>(extraLength) };
        return true;
    }
};

class LintNodeMaker {
public:
    LintNodeMaker(JSGlobalObject* globalObject, const LintTree& tree, JSArray* nodes, JSString* text, JSArray* knownStrings)
        : m_globalObject(globalObject)
        , m_vm(globalObject->vm())
        , m_tree(tree)
        , m_nodes(nodes)
        , m_text(text)
        , m_textLength(text->length())
        , m_knownStrings(knownStrings)
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
                return jsUndefined();
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
            return m_knownStrings->tryGetIndexQuickly(number);
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
            JSObject* object = constructEmptyObject(m_globalObject);
            object->putDirect(m_vm, tag == 9 ? m_pattern : m_cooked, first);
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
    JSArray* m_knownStrings;
    JSString* m_extraText { nullptr };
    Identifier m_pattern, m_flags, m_cooked, m_raw;
};

} // namespace

// The nodes of the tree in `bytes`, by their number. Null: an exception was thrown.
// `shapes`: by the number of a type what `shape` has made, or a list of these if fields of the type can be left out: by
// which of them are there, the first being the lowest bit. `leftOut`: by the number of a type, a bit for each such field.
// Rust keeps `bytes` until the file is done.
static JSArray* makeLintNodes(JSGlobalObject* globalObject, JSArray* shapes, JSUint32Array* leftOut, std::span<const uint8_t> bytes, JSString* text, JSArray* knownStrings)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto outOfStep = [&]() -> JSArray* {
        throwTypeError(globalObject, scope, "The tree is not as expected"_s);
        return nullptr;
    };

    LintTree tree;
    if (!tree.read(bytes))
        return outOfStep();
    uint32_t count = tree.count;

    // By type: the structures, by which fields are there, and how many fields there are at most.
    struct Shape {
        Vector<JSObject*, 1> objects;
        uint32_t leftOut { 0 };
        uint32_t fields { 0 };
    };
    unsigned typeCount = std::min<unsigned>(shapes->length(), 256);
    Vector<Shape, 256> byType(typeCount);
    for (unsigned type = 0; type < typeCount; ++type) {
        JSValue shape = shapes->getIndex(globalObject, type);
        RETURN_IF_EXCEPTION(scope, nullptr);
        Shape& entry = byType[type];
        entry.leftOut = type < leftOut->length() ? leftOut->typedVector()[type] : 0;
        if (JSArray* several = dynamicDowncast<JSArray>(shape)) {
            for (unsigned i = 0; i < several->length(); ++i) {
                JSObject* object = several->getIndex(globalObject, i).getObject();
                RETURN_IF_EXCEPTION(scope, nullptr);
                if (!object)
                    return outOfStep();
                entry.objects.append(object);
            }
        } else if (JSObject* object = shape.getObject())
            entry.objects.append(object);
        if (entry.objects.isEmpty())
            continue;
        if (entry.objects.size() != 1u << std::popcount(entry.leftOut))
            return outOfStep();
        // `type` before them, `start`, `end`, `range` and `parent` behind.
        entry.fields = entry.objects.last()->structure()->maxOffset() + 1 - 5;
    }

    // Where the words of each node start.
    Vector<uint32_t> offsets(count);
    uint64_t at = 0;
    for (uint32_t id = 0; id < count; ++id) {
        uint8_t type = tree.types[id];
        if (type >= typeCount || byType[type].objects.isEmpty())
            return outOfStep();
        offsets[id] = static_cast<uint32_t>(at);
        at += byType[type].fields;
    }
    if (at > tree.fields.size())
        return outOfStep();

    JSArray* nodes = tryCreateFilledLintArray(vm, globalObject, count);
    if (!nodes) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return nullptr;
    }
    Structure* rangeStructure = globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithInt32);
    LintNodeMaker maker(globalObject, tree, nodes, text, knownStrings);

    // What is in a node has a higher number.
    for (uint32_t id = count; id--;) {
        const Shape& shape = byType[tree.types[id]];
        const uint32_t* words = tree.fields.data() + offsets[id];
        uint32_t start = tree.starts[id], end = tree.ends[id];
        unsigned which = 0;
        if (shape.leftOut) [[unlikely]] {
            unsigned bit = 0;
            for (uint32_t i = 0; i < shape.fields; ++i) {
                if (shape.leftOut >> i & 1)
                    which |= (words[i] ? 1u : 0u) << bit++;
            }
        }
        JSObject* like = shape.objects[which];
        JSFinalObject* node = JSFinalObject::create(vm, like->structure());
        PropertyOffset offset = 0;
        node->putDirectOffset(vm, offset++, like->getDirect(0));
        for (uint32_t i = 0; i < shape.fields; ++i) {
            if ((shape.leftOut >> i & 1) && !words[i]) [[unlikely]]
                continue;
            JSValue value = maker.value(words[i], start, end);
            RETURN_IF_EXCEPTION(scope, nullptr);
            if (!value) [[unlikely]]
                return outOfStep();
            node->putDirectOffset(vm, offset++, value);
        }
        node->putDirectOffset(vm, offset++, jsNumber(start));
        node->putDirectOffset(vm, offset++, jsNumber(end));
        node->putDirectOffset(vm, offset + 1, jsNull());
        JSArray* range;
        {
            ObjectInitializationScope initializationScope(vm);
            range = JSArray::tryCreateUninitializedRestricted(initializationScope, rangeStructure, 2);
            if (!range) [[unlikely]] {
                throwOutOfMemoryError(globalObject, scope);
                return nullptr;
            }
            range->initializeIndex(initializationScope, 0, jsNumber(start));
            range->initializeIndex(initializationScope, 1, jsNumber(end));
        }
        node->putDirectOffset(vm, offset, range);
        nodes->setIndexQuickly(vm, id, node);
    }
    for (uint32_t id = 1; id < count; ++id) {
        if (tree.parents[id] >= count)
            return outOfStep();
        JSObject* node = asObject(nodes->getIndexQuickly(id));
        node->putDirectOffset(vm, node->structure()->maxOffset(), nodes->getIndexQuickly(tree.parents[id]));
    }
    LintHost* host = LintHost::from(globalObject);
    host->sourceCode.setTree(vm, host, nullptr, nodes, tree.starts, tree.ends, tree.parents);
    return nodes;
}

// `listen(shapes, leftOut, knownStrings, words, length)` tells Rust what the rules listen for in the file that's being linted: the
// first `length` of `words`, a `Uint32Array`, as `LISTEN` in src/lint/js_plugin/wire.rs describes them.
// Returns `[calls, nodes]`. `calls`: a `Uint32Array`, see src/lint/js_plugin/calls.rs. `nodes`: those of the file by their number,
// or `undefined` if the tree didn't come.
JSC_DEFINE_HOST_FUNCTION(jsLintListen, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto outOfStep = [&] { return throwVMTypeError(globalObject, scope, "The calls are not as expected"_s); };
    constexpr uint32_t listen = 14;

    JSArray* shapes = dynamicDowncast<JSArray>(callFrame->argument(0));
    auto* leftOut = dynamicDowncast<JSUint32Array>(callFrame->argument(1));
    JSArray* knownStrings = dynamicDowncast<JSArray>(callFrame->argument(2));
    auto* words = dynamicDowncast<JSUint32Array>(callFrame->argument(3));
    JSValue length = callFrame->argument(4);
    LintHost* host = LintHost::from(globalObject);
    if (!shapes || !leftOut || leftOut->isDetached() || !knownStrings || !words || words->isDetached() || !length.isNumber() || !host->isLinting())
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
        JSArray* nodes = makeLintNodes(globalObject, shapes, leftOut, bytes.subspan(8 + callBytes), host->text(), knownStrings);
        RETURN_IF_EXCEPTION(scope, {});
        result->setIndexQuickly(vm, 1, nodes);
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

// `codePaths(shapes, origins, buffer)` returns `[codePaths, segments, events]`. The first two are indexed as in the message, which is
// in `buffer`, or is asked for if that's `undefined`. `events`: a `Uint32Array` with the four words of each event.
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
    auto* buffer = dynamicDowncast<JSArrayBuffer>(callFrame->argument(2));
    if (!shapes || !origins || !LintHost::from(globalObject)->isLinting())
        return outOfStep();
    constexpr uint32_t codePathsOfFile = 11;
    LintSpan answer = buffer ? LintSpan {} : Bun__Lint__ask(globalObject, codePathsOfFile, nullptr, 0);
    std::span<const uint8_t> bytes = buffer ? buffer->impl()->span() : std::span<const uint8_t> { answer.ptr, answer.len };

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

// LintScopes.cpp
void addLintScopeFunctions(JSGlobalObject*, JSObject* native);

// `{ shape, listen, codePaths, .. }` for the program in src/lint/js_plugin/worker.
extern "C" EncodedJSValue Bun__Lint__nodeFunctions(JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    JSObject* object = constructEmptyObject(globalObject);
    object->putDirect(vm, Identifier::fromString(vm, "shape"_s), JSFunction::create(vm, globalObject, 4, "shape"_s, jsLintShape, ImplementationVisibility::Public));
    object->putDirect(vm, Identifier::fromString(vm, "listen"_s), JSFunction::create(vm, globalObject, 5, "listen"_s, jsLintListen, ImplementationVisibility::Public));
    object->putDirect(vm, Identifier::fromString(vm, "codePaths"_s), JSFunction::create(vm, globalObject, 3, "codePaths"_s, jsLintCodePaths, ImplementationVisibility::Public));
    addLintHostFunctions(globalObject, object);
    addLintScopeFunctions(globalObject, object);
    return JSValue::encode(object);
}

} // namespace Bun
