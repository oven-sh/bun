// Makes the nodes of a syntax tree for the rules that `bun lint` runs in JavaScript, from the arrays that
// src/lint/js_plugin/ast.rs writes: one call for a file. The nodes are plain objects with their fields as own data
// properties in the parser's order, as a parser in JavaScript makes them. See src/lint/js_plugin/worker/ast.js, which
// does the same where this is not there.

#include "root.h"

#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSGenericTypedArrayViewInlines.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/ObjectInitializationScope.h>

namespace Bun {
using namespace JSC;

// `shape(prototype, keys, type)`: an object that has `keys`, in that order, in its own cell, and `type` as the first.
// `nodes` makes objects of the same structure.
JSC_DEFINE_HOST_FUNCTION(jsLintShape, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* prototype = callFrame->argument(0).getObject();
    JSArray* keys = dynamicDowncast<JSArray>(callFrame->argument(1));
    if (!prototype || !keys || !keys->length() || keys->length() > JSFinalObject::maxInlineCapacity)
        return throwVMTypeError(globalObject, scope, "Expected a prototype and keys"_s);
    unsigned count = keys->length();
    Structure* structure = JSFinalObject::createStructure(vm, globalObject, prototype, count);
    for (unsigned i = 0; i < count; ++i) {
        JSValue key = keys->getIndex(globalObject, i);
        RETURN_IF_EXCEPTION(scope, {});
        Identifier name = key.toPropertyKey(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        PropertyOffset offset;
        structure = Structure::addPropertyTransition(vm, structure, name, 0, offset);
        RELEASE_ASSERT(offset == static_cast<PropertyOffset>(i));
    }
    JSFinalObject* object = JSFinalObject::create(vm, structure);
    object->putDirectOffset(vm, 0, callFrame->argument(2));
    for (unsigned i = 1; i < count; ++i)
        object->putDirectOffset(vm, i, jsUndefined());
    return JSValue::encode(object);
}

namespace {

// The message of `ast::write`: ten words, then the parts whose lengths these are.
struct LintTree {
    uint32_t count, fieldCount, listCount, stringCount;
    std::span<const uint8_t> numbers;
    std::span<const uint32_t> starts, ends, parents, fields, lists, strings;
    std::span<const uint8_t> types;

    bool read(std::span<const uint8_t> bytes)
    {
        constexpr size_t header = 10;
        if (bytes.size() < header * 4 || reinterpret_cast<uintptr_t>(bytes.data()) % 8)
            return false;
        auto* words = reinterpret_cast<const uint32_t*>(bytes.data());
        count = words[0];
        fieldCount = words[1];
        listCount = words[2];
        stringCount = words[3];
        uint64_t twice = words[4], matches = words[5], numberCount = words[6], extra = words[7];
        uint64_t size = header * 4 + numberCount * 8 + (uint64_t(count) * 3 + fieldCount + listCount + stringCount + twice + matches) * 4 + count + extra;
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
        part(twice);
        part(matches);
        types = { at, count };
        return true;
    }
};

class LintNodeMaker {
public:
    LintNodeMaker(JSGlobalObject* globalObject, const LintTree& tree, JSArray* nodes, JSString* text, JSArray* knownStrings, JSObject* slow)
        : m_globalObject(globalObject)
        , m_vm(globalObject->vm())
        , m_tree(tree)
        , m_nodes(nodes)
        , m_text(text)
        , m_textLength(text->length())
        , m_knownStrings(knownStrings)
        , m_slow(slow)
    {
    }

    // What a word stands for, in a node from `start` to `end`: `value` in ast.js. Empty: an exception, or out of step.
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
            uint32_t from = m_tree.strings[2 * number];
            // In the text that comes with the tree, which is rare.
            if (from >= 0x80000000)
                break;
            return slice(from, m_tree.strings[2 * number + 1]);
        }
        case 4:
            return number < m_knownStrings->length() ? m_knownStrings->getIndexQuickly(number) : JSValue();
        case 5:
            return jsNumber(number);
        case 6: {
            if (uint64_t(number) * 8 + 8 > m_tree.numbers.size())
                return {};
            double result;
            memcpy(&result, m_tree.numbers.data() + size_t(number) * 8, 8);
            return jsNumber(purifyNaN(result));
        }
        default:
            break;
        }
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        MarkedArgumentBuffer arguments;
        arguments.append(jsNumber(word));
        arguments.append(jsNumber(start));
        arguments.append(jsNumber(end));
        JSValue result = call(m_globalObject, m_slow, arguments, "Expected a function"_s);
        RETURN_IF_EXCEPTION(scope, {});
        return result;
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

    JSValue list(uint32_t at)
    {
        auto scope = DECLARE_THROW_SCOPE(m_vm);
        if (at >= m_tree.lists.size() || m_tree.lists[at] >= m_tree.lists.size() - at)
            return {};
        uint32_t length = m_tree.lists[at];
        MarkedArgumentBuffer items;
        for (uint32_t i = 1; i <= length; ++i) {
            uint32_t id = m_tree.lists[at + i];
            JSValue item = id ? node(id) : jsNull();
            if (!item)
                return {};
            items.append(item);
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
    JSObject* m_slow;
};

} // namespace

// `nodes(shapes, leftOut, buffer, text, knownStrings, slow)`: the nodes of the tree in `buffer`, by their number.
// `shapes`: by the number of a type what `shape` has made, or a list of these if fields of the type can be left out: by
// which of them are there, the first being the lowest bit. `leftOut`: by the number of a type, a bit for each such field.
// `slow(word, start, end)`: `value` of ast.js, for what is rare.
JSC_DEFINE_HOST_FUNCTION(jsLintNodes, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto outOfStep = [&] { return throwVMTypeError(globalObject, scope, "The tree is not as expected"_s); };

    JSArray* shapes = dynamicDowncast<JSArray>(callFrame->argument(0));
    auto* leftOut = dynamicDowncast<JSUint32Array>(callFrame->argument(1));
    auto* buffer = dynamicDowncast<JSArrayBuffer>(callFrame->argument(2));
    JSValue textValue = callFrame->argument(3);
    JSArray* knownStrings = dynamicDowncast<JSArray>(callFrame->argument(4));
    JSObject* slow = callFrame->argument(5).getObject();
    if (!shapes || !leftOut || leftOut->isDetached() || !buffer || !textValue.isString() || !knownStrings || !slow)
        return outOfStep();
    JSString* text = asString(textValue);
    text->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    LintTree tree;
    if (!tree.read(buffer->impl()->span()))
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
        RETURN_IF_EXCEPTION(scope, {});
        Shape& entry = byType[type];
        entry.leftOut = type < leftOut->length() ? leftOut->typedVector()[type] : 0;
        if (JSArray* several = dynamicDowncast<JSArray>(shape)) {
            for (unsigned i = 0; i < several->length(); ++i) {
                JSObject* object = several->getIndex(globalObject, i).getObject();
                RETURN_IF_EXCEPTION(scope, {});
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

    JSArray* nodes = JSArray::tryCreate(vm, globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithContiguous), count);
    if (!nodes) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    Structure* rangeStructure = globalObject->arrayStructureForIndexingTypeDuringAllocation(ArrayWithInt32);
    LintNodeMaker maker(globalObject, tree, nodes, text, knownStrings, slow);

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
            RETURN_IF_EXCEPTION(scope, {});
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
                return {};
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
    return JSValue::encode(nodes);
}

// `{ shape, nodes }`, for the program of src/lint/js_plugin/worker.
extern "C" EncodedJSValue Bun__Lint__nodeFunctions(JSGlobalObject* globalObject)
{
    VM& vm = globalObject->vm();
    JSObject* object = constructEmptyObject(globalObject);
    object->putDirect(vm, Identifier::fromString(vm, "shape"_s), JSFunction::create(vm, globalObject, 3, "shape"_s, jsLintShape, ImplementationVisibility::Public));
    object->putDirect(vm, Identifier::fromString(vm, "nodes"_s), JSFunction::create(vm, globalObject, 6, "nodes"_s, jsLintNodes, ImplementationVisibility::Public));
    return JSValue::encode(object);
}

} // namespace Bun
