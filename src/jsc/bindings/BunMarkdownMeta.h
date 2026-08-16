#pragma once
#include "root.h"
#include "headers.h"
#include "JavaScriptCore/JSObjectInlines.h"
#include "ZigGlobalObject.h"

using namespace JSC;

namespace Bun {
namespace MarkdownMeta {

// Cached Structures for the small metadata objects passed as the second
// argument to Bun.markdown.render() callbacks. These have fixed shapes
// so JSC's property access inline caches stay monomorphic and we avoid
// the string-hash + property-transition cost of `put()`-style construction
// on every callback (which matters a lot for list items and table cells).

Structure* createListItemMetaStructure(VM& vm, JSGlobalObject* globalObject);
Structure* createListMetaStructure(VM& vm, JSGlobalObject* globalObject);
Structure* createCellMetaStructure(VM& vm, JSGlobalObject* globalObject);
Structure* createLinkMetaStructure(VM& vm, JSGlobalObject* globalObject);

} // namespace MarkdownMeta
} // namespace Bun

// ListItemMeta: {index, depth, ordered, start, checked}
// `start` and `checked` are always present (jsUndefined() when not applicable)
// so the shape is fixed.
extern "C" JSC::EncodedJSValue BunMarkdownMeta__createListItem(
    JSGlobalObject* globalObject,
    uint32_t index,
    uint32_t depth,
    bool ordered,
    EncodedJSValue start, // jsNumber or jsUndefined
    EncodedJSValue checked // jsBoolean or jsUndefined
);

// ListMeta: {ordered, start, depth}
// `start` is always present (jsUndefined for unordered).
extern "C" JSC::EncodedJSValue BunMarkdownMeta__createList(
    JSGlobalObject* globalObject,
    bool ordered,
    EncodedJSValue start, // jsNumber or jsUndefined
    uint32_t depth);

// CellMeta: {align}
// `align` is always present (jsUndefined when no alignment).
extern "C" JSC::EncodedJSValue BunMarkdownMeta__createCell(
    JSGlobalObject* globalObject,
    EncodedJSValue align // jsString or jsUndefined
);

// LinkMeta / ImageMeta: {href, title} or {src, title}
// `title` is always present (jsUndefined when missing). `href` and `src`
// share the structure slot (first property) — the property name differs
// but the shape is the same; two separate structures are used.
extern "C" JSC::EncodedJSValue BunMarkdownMeta__createLink(
    JSGlobalObject* globalObject,
    EncodedJSValue href,
    EncodedJSValue title // jsString or jsUndefined
);
