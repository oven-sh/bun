import * as b from "../../../codegen/bindgen-lib.ts";

export default b.module({
  rustPath: "crate::api::core::collections",
  ceReactions: "crate::api::core::custom",
  feature: "Desktop",
});

const heap = { capability: "heap" } as const;
const allocates = { capability: "heap", throws: true } as const;
const js = { capability: "js", throws: true } as const;
const ce = { ...js, ceReactions: true } as const;
const attr = b.ref("Attr");
const string = b.DOMString;
const index = b.u32.wrap;
const path = (name: string) => `crate::api::core::${name}`;

/** `owner` is the root, or the array of a static list. */
export const Collection = b.interface("Collection", {
  abstract: true,
  rustPath: path("Collection"),
  size: 96,
  internalFields: ["owner"],
});

export const NodeList = b.interface("NodeList", {
  extends: Collection,
  indexed: { getter: b.ref("Node"), length: "len" },
  iterable: "values",
  proto: {
    length: { getter: b.u32, ...heap },
    item: { args: { index }, returns: b.ref("Node").nullable, rustName: "indexed_get" },
  },
});

export const HTMLCollection = b.interface("HTMLCollection", {
  extends: Collection,
  indexed: { getter: b.ref("Node"), length: "len" },
  named: { getter: b.any, unenumerable: true, ...heap },
  proto: {
    length: { getter: b.u32, ...heap },
    item: { args: { index }, returns: b.ref("Node").nullable, rustName: "indexed_get" },
    namedItem: { args: { name: string.atom }, returns: b.any, ...heap },
  },
});

export const HTMLAllCollection = b.interface("HTMLAllCollection", {
  extends: Collection,
  indexed: { getter: b.ref("Node"), length: "len" },
  named: { getter: b.any, unenumerable: true, ...heap },
  masqueradesAsUndefined: true,
  callInstance: { args: { nameOrIndex: string.atom.optional }, returns: b.any, ...heap },
  proto: {
    length: { getter: b.u32, ...heap },
    namedItem: { args: { name: string.atom }, returns: b.any, ...heap },
    item: { args: { nameOrIndex: string.atom.optional }, returns: b.any, ...heap },
  },
});

export const DOMTokenList = b.interface("DOMTokenList", {
  rustPath: path("DOMTokenList"),
  internalFields: { element: b.ref("DomElement") },
  indexed: { getter: string, ...heap },
  iterable: "values",
  proto: {
    length: { getter: b.u32 },
    value: { getter: string.impl, setter: { capability: "js" }, stringifier: true, ceReactions: true, ...heap },
    item: { args: { index }, returns: string.nullable, rustName: "indexed_get", ...heap },
    contains: { args: { token: string.impl }, returns: b.bool, rustName: "js_contains" },
    add: { args: { tokens: b.rest(b.any) }, ...ce },
    remove: { args: { tokens: b.rest(b.any) }, ...ce },
    toggle: { args: { token: string.impl, force: b.bool.loose.optional }, returns: b.bool, ...ce },
    replace: { args: { token: string.impl, newToken: string.impl }, returns: b.bool, ...ce },
    supports: { args: { token: string.impl }, returns: b.bool, ...allocates },
  },
});

export const NamedNodeMap = b.interface("NamedNodeMap", {
  internalFields: { element: b.ref("DomElement") },
  indexed: { getter: attr, ...heap },
  named: { getter: attr, unenumerable: true, ...heap },
  proto: {
    length: { getter: b.u32 },
    item: { args: { index }, returns: attr.nullable, rustName: "indexed_get", ...heap },
    getNamedItem: { args: { qualifiedName: string }, returns: attr.nullable, ...allocates },
    getNamedItemNS: {
      args: { namespace: string.nullable, localName: string },
      returns: attr.nullable,
      rustName: "get_named_item_ns",
      ...allocates,
    },
    setNamedItem: { args: { attr }, returns: attr.nullable, ...ce },
    setNamedItemNS: { args: { attr }, returns: attr.nullable, rustName: "set_named_item", ...ce },
    removeNamedItem: { args: { qualifiedName: string }, returns: attr, ...ce },
    removeNamedItemNS: {
      args: { namespace: string.nullable, localName: string },
      returns: attr,
      rustName: "remove_named_item_ns",
      ...ce,
    },
  },
});

export const DOMStringMap = b.interface("DOMStringMap", {
  internalFields: { element: b.ref("DomElement") },
  named: { getter: string.impl, setter: true, deleter: true, overrideBuiltIns: true, ...ce },
  proto: {},
});
