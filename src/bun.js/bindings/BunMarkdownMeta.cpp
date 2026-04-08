#include "BunMarkdownMeta.h"

#include "JavaScriptCore/JSObjectInlines.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/JSCast.h"

using namespace JSC;

namespace Bun {
namespace MarkdownMeta {

// Builds a cached Structure with N fixed property offsets. Properties are
// laid out in declaration order so the extern "C" create functions can use
// putDirectOffset without name lookups.
static Structure* buildStructure(VM& vm, JSGlobalObject* globalObject, std::initializer_list<ASCIILiteral> names)
{
    Structure* structure = globalObject->structureCache().emptyObjectStructureForPrototype(
        globalObject,
        globalObject->objectPrototype(),
        names.size());

    PropertyOffset offset;
    PropertyOffset expected = 0;
    for (auto name : names) {
        structure = structure->addPropertyTransition(vm, structure, Identifier::fromString(vm, name), 0, offset);
        ASSERT_UNUSED(expected, offset == expected);
        expected++;
    }
    return structure;
}

Structure* createListItemMetaStructure(VM& vm, JSGlobalObject* globalObject)
{
    return buildStructure(vm, globalObject, { "index"_s, "depth"_s, "ordered"_s, "start"_s, "checked"_s });
}

Structure* createListMetaStructure(VM& vm, JSGlobalObject* globalObject)
{
    return buildStructure(vm, globalObject, { "ordered"_s, "start"_s, "depth"_s });
}

Structure* createCellMetaStructure(VM& vm, JSGlobalObject* globalObject)
{
    return buildStructure(vm, globalObject, { "align"_s });
}

Structure* createLinkMetaStructure(VM& vm, JSGlobalObject* globalObject)
{
    return buildStructure(vm, globalObject, { "href"_s, "title"_s });
}

} // namespace MarkdownMeta
} // namespace Bun

// ──────────────────────────────────────────────────────────────────────────
// extern "C" constructors — callable from MarkdownObject.zig
// ──────────────────────────────────────────────────────────────────────────

extern "C" JSC::EncodedJSValue BunMarkdownMeta__createListItem(
    JSGlobalObject* globalObject,
    uint32_t index,
    uint32_t depth,
    bool ordered,
    EncodedJSValue start,
    EncodedJSValue checked)
{
    auto* global = jsCast<Zig::GlobalObject*>(globalObject);
    VM& vm = global->vm();

    JSObject* obj = constructEmptyObject(vm, global->JSMarkdownListItemMetaStructure());
    obj->putDirectOffset(vm, 0, jsNumber(index));
    obj->putDirectOffset(vm, 1, jsNumber(depth));
    obj->putDirectOffset(vm, 2, jsBoolean(ordered));
    obj->putDirectOffset(vm, 3, JSValue::decode(start));
    obj->putDirectOffset(vm, 4, JSValue::decode(checked));

    return JSValue::encode(obj);
}

extern "C" JSC::EncodedJSValue BunMarkdownMeta__createList(
    JSGlobalObject* globalObject,
    bool ordered,
    EncodedJSValue start,
    uint32_t depth)
{
    auto* global = jsCast<Zig::GlobalObject*>(globalObject);
    VM& vm = global->vm();

    JSObject* obj = constructEmptyObject(vm, global->JSMarkdownListMetaStructure());
    obj->putDirectOffset(vm, 0, jsBoolean(ordered));
    obj->putDirectOffset(vm, 1, JSValue::decode(start));
    obj->putDirectOffset(vm, 2, jsNumber(depth));

    return JSValue::encode(obj);
}

extern "C" JSC::EncodedJSValue BunMarkdownMeta__createCell(
    JSGlobalObject* globalObject,
    EncodedJSValue align)
{
    auto* global = jsCast<Zig::GlobalObject*>(globalObject);
    VM& vm = global->vm();

    JSObject* obj = constructEmptyObject(vm, global->JSMarkdownCellMetaStructure());
    obj->putDirectOffset(vm, 0, JSValue::decode(align));

    return JSValue::encode(obj);
}

extern "C" JSC::EncodedJSValue BunMarkdownMeta__createLink(
    JSGlobalObject* globalObject,
    EncodedJSValue href,
    EncodedJSValue title)
{
    auto* global = jsCast<Zig::GlobalObject*>(globalObject);
    VM& vm = global->vm();

    JSObject* obj = constructEmptyObject(vm, global->JSMarkdownLinkMetaStructure());
    obj->putDirectOffset(vm, 0, JSValue::decode(href));
    obj->putDirectOffset(vm, 1, JSValue::decode(title));

    return JSValue::encode(obj);
}
