// Interfaces that exist to test the binding generator: test/internal/bindgen.test.ts
import * as b from "../codegen/bindgen-lib.ts";

const path = "crate::bindgen_interface_test";
export default b.module({ rustPath: path, ceReactions: `${path}::reactions`, isCold: true });

const heap = { capability: "heap" } as const;
const throws = { capability: "heap", throws: true } as const;

export const WebInit = b.dictionary(
  { label: b.DOMString.utf8.default("none"), owner: b.ref("WebNode").nullable.optional },
  { webidl: true },
);
export const WebLeafInit = b.dictionary({ count: b.u32.wrap.default(1) }, { webidl: true, extends: WebInit });
export const WebMode = b.enumeration(["open", "closed"]);
export const WebNodeOrString = b.union({ node: b.ref("WebNode"), string: b.DOMString }, { webidl: true });
export const WebMixed = b.union(
  {
    text: b.DOMString,
    number: b.double,
    init: WebInit,
    list: b.sequence(b.ref("WebNode").nullable),
    floats: b.typedArray("Float32Array"),
    node: b.ref("WebNode"),
    callback: b.callable,
  },
  { webidl: true },
);

export const WebTarget = b.interface("WebTarget", {
  rustPath: `${path}::WebTarget`,
  size: 8,
  inlineCapacity: 2,
  internalFields: ["listeners"],
  construct: {},
  proto: {
    id: { getter: b.u32 },
    listeners: { getter: b.any, field: "listeners", writable: true },
    remember: { args: { value: b.any }, returns: b.bool },
    mark: { returns: b.bool },
  },
});

export const WebNode = b.interface("WebNode", {
  isCold: false,
  extends: WebTarget,
  rustPath: `${path}::WebNode`,
  size: 56,
  internalFields: { parent: b.ref("WebNode"), first: b.ref("WebNode") },
  constants: { FIRST: 1, SECOND: 2 },
  proto: {
    parent: { getter: b.ref("WebNode").nullable, field: "parent" },
    adopt: { args: { child: b.ref("WebNode") }, returns: b.ref("WebNode"), ceReactions: true, ...throws },
    isSame: { args: { other: b.ref("WebNode").nullable }, returns: b.bool },
    label: { getter: b.DOMString.utf8, setter: { type: b.DOMString.nullToEmpty.utf8 }, ceReactions: true },
    describe: { args: { values: b.rest(WebNodeOrString) }, returns: b.string.utf8, unscopable: true, ...throws },
    fail: { args: { code: b.u8.wrap }, ...throws },
    later: { args: { value: b.double }, returns: b.any, rejects: true, capability: "js" },
  },
});

export const WebParent = b.mixin("WebParent", {
  on: WebNode,
  proto: {
    childLabel: { getter: b.DOMString.utf8.nullable },
    depth: { getter: b.u32, setter: { type: b.u32.enforceRange() }, isCold: false },
    repeat: { args: { times: b.u8.clamp }, returns: b.string.utf8, isCold: false },
  },
});

export const WebNamedSlot = b.family("WebNamedSlot", { on: WebNode, getter: b.i32, setter: { type: b.i32.wrap } });

export const WebSlot = b.family("WebSlot", {
  on: WebNode,
  key: `${path}::Slot`,
  getter: b.i32.wrap,
  setter: true,
});

export const WebElement = b.interface("WebElement", {
  name: "RenamedElement",
  extends: WebNode,
  includes: [WebParent],
  construct: { args: { init: WebInit.default({}) }, passStructure: true, ...heap },
  proto: {
    x: WebSlot.of(`${path}::Slot::X`),
    y: WebSlot.of(`${path}::Slot::Y`),
    left: WebNamedSlot.of(),
    top: WebNamedSlot.of(),
    lenientTop: WebNamedSlot.of(undefined, { lenientThis: true }),
    style: { getter: b.ref("WebStyle"), cache: true, putForwards: "text", ...heap },
    adopted: {
      getter: b.any,
      cache: true,
      setter: { type: b.sequence(b.ref("WebNode")), capability: "js", throws: true },
      ...heap,
    },
    adoptedLabels: { returns: b.sequence(b.string.utf8), ...throws },
    floats: { args: { first: WebNodeOrString.default("a") }, returns: b.typedArray("Float32Array"), ...throws },
    mode: { getter: WebMode, setter: true, ignoreInvalid: true },
    shadowed: { getter: b.u32, replaceable: true },
    lenient: { getter: b.u32, lenientThis: true, lenientSetter: true },
    atom: { args: { name: b.DOMString.atom }, returns: b.bool },
    strings: {
      args: { usv: b.USVString, bytes: b.ByteString.optional, impl: b.DOMString.impl.default("x") },
      returns: b.DOMString.impl,
    },
    choose: [
      { args: { name: b.DOMString }, returns: b.string.utf8, rustName: "choose_name" },
      { args: { init: WebInit.default({}) }, returns: b.string.utf8, rustName: "choose_init" },
      { args: { list: b.sequence(b.any) }, returns: b.string.utf8, rustName: "choose_list" },
    ],
    pick: [
      { args: {}, returns: b.string.utf8, rustName: "pick_none" },
      { args: { node: b.ref("WebNode"), text: b.DOMString.utf8 }, returns: b.string.utf8, rustName: "pick_node" },
      { args: { a: b.double, b: b.double }, returns: b.string.utf8, rustName: "pick_numbers" },
    ],
  },
});

export const WebElementMore = b.partial("WebElementMore", { on: WebElement, proto: { more: { returns: b.u32 } } });

export const WebPlain = b.interface("WebPlain", { extends: WebElement, construct: { passStructure: true, ...heap } });

export const WebFragment = b.interface("WebFragment", {
  extends: WebNode,
  includes: [WebParent],
  construct: { passNewTarget: true, capability: "js", throws: true },
  proto: { y: WebSlot.of(`${path}::Slot::Y`) },
});

export const WebLeaf = b.interface("WebLeaf", {
  isCold: false,
  extends: WebElement,
  rustPath: `${path}::WebLeaf`,
  internalFields: ["extra"],
  construct: [
    { args: { init: WebLeafInit.default({}) } },
    { args: { count: b.u32.wrap, label: b.DOMString.utf8 }, rustName: "from_count" },
  ],
  proto: {
    count: { getter: b.u32 },
    extra: { getter: b.any, field: "extra", writable: true },
    trusted: { getter: b.bool, unforgeable: true },
  },
});

export const WebPinned = b.interface("WebPinned", {
  construct: {},
  proto: { pinned: { getter: b.u32, unforgeable: true }, pin: { returns: b.u32, unforgeable: true } },
});

export const WebStyle = b.interface("WebStyle", {
  rustPath: `${path}::WebStyle`,
  noInterfaceObject: true,
  proto: {
    text: { getter: b.f64, setter: { type: b.f64.loose }, stringifier: true },
  },
});

export const WebShape = b.interface("WebShape", { abstract: true, rustPath: `${path}::WebShape` });
export const WebSides = b.mixin("WebSides", { on: WebShape, proto: { sides: { getter: b.u32 } } });
export const WebSquare = b.interface("WebSquare", { extends: WebShape, includes: [WebSides], construct: {} });
export const WebEmitter = b.interface("WebEmitter", { prototypeBase: "EventEmitter", construct: {} });

export const WebList = b.interface("WebList", {
  isCold: false,
  rustPath: `${path}::WebList`,
  construct: { args: { items: b.sequenceVec(b.i32.wrap).default([]) } },
  indexed: { getter: b.i32 },
  iterable: "values",
  proto: {
    length: { getter: b.u32 },
    push: { args: { item: b.i32.wrap } },
    append: { args: { items: b.sequenceVec(b.i32.wrap), more: b.sequenceVec(b.i32.wrap).optional } },
  },
});
export const WebNamedList = b.interface("WebNamedList", {
  extends: WebList,
  construct: {},
  indexed: { getter: b.i32.wrap, setter: true },
  named: { getter: b.i32, unenumerable: true },
});
export const WebMap = b.interface("WebMap", {
  isCold: false,
  rustPath: `${path}::WebMap`,
  construct: { args: { init: b.recordOf(b.DOMString.atom, b.i32.wrap) } },
  named: { getter: b.i32.wrap, setter: true, deleter: true, overrideBuiltIns: true },
});
export const WebAll = b.interface("WebAll", {
  construct: {},
  masqueradesAsUndefined: true,
  callInstance: { returns: b.u32 },
});

export const WebRegistry = b.interface("WebRegistry", { construct: {}, maplike: { key: b.DOMString, value: WebNode } });
export const WebSet = b.interface("WebSet", {
  construct: {},
  setlike: { value: b.i32.wrap, prepare: true },
  proto: { sum: { returns: b.f64, ...throws } },
});

export const WebPointBase = b.interface("WebPointBase", { abstract: true, rustPath: `${path}::WebPoint` });
export const WebPoint3 = b.interface("WebPoint3", {
  extends: WebPointBase,
  construct: {},
  defaultToJSON: true,
  serializable: true,
  proto: { z: { getter: b.f64 }, hidden: { getter: b.f64, exposed: ["SharedWorker"], secure: true } },
});
export const WebPoint = b.interface("WebPoint", {
  isCold: false,
  rustPath: `${path}::WebOtherPoint`,
  construct: { args: { x: b.double } },
  aliases: ["webkitPoint"],
  legacyFactory: { Point: { args: { x: b.double.default(1) } } },
  defaultToJSON: true,
  proto: { x: { getter: b.f64 }, anything: { getter: b.any } },
});
export const WebException = b.interface("WebException", {
  abstract: true,
  prototypeBase: "DOMException",
  rustPath: `${path}::WebException`,
  size: 8,
});
export const WebError = b.interface("WebError", {
  extends: WebException,
  internalFields: ["extra"],
  construct: { args: { message: b.DOMString.impl, extra: b.any }, passStructure: true, ...heap },
  proto: { extra: { getter: b.any, field: "extra" } },
});
export const WebByName = b.interface("WebByName", {
  isCold: false,
  extends: WebPointBase,
  construct: {},
  attributesByName: { getter: b.double, setter: true },
});
export const WebSpace = b.interface("WebSpace", {
  namespace: true,
  static: { twice: { args: { value: b.double }, returns: b.f64 }, isWindow: { getter: b.bool, ...heap } },
});
export const WebFilter = b.interface("WebFilter", { callbackInterface: true, constants: { ALL: 0xffffffff } });
export const WebIterator = b.interface("WebIterator", {
  name: "WebPairs Iterator",
  extends: WebPointBase,
  noInterfaceObject: true,
  prototypeBase: "Iterator",
  proto: { next: { returns: b.object, ...heap } },
});
export const WebPairs = b.interface("WebPairs", {
  construct: {},
  sameFunction: { "@@iterator": "entries" },
  proto: { entries: { returns: WebIterator, ...heap } },
});

export const WebGlobalBase = b.interface("WebGlobalBase", { construct: {}, proto: { who: { returns: b.u32 } } });
export const WebGlobal = b.interface("WebGlobal", { extends: WebGlobalBase, global: true, construct: {} });

export const setGlobalReceiver = b.fn({ args: { receiver: WebGlobal }, ...heap });
export const onReaction = b.fn({ args: { target: WebTarget }, capability: "js" });
export const droppedNodes = b.fn({ returns: b.usize });
export const kindOf = b.fn({ args: { target: WebTarget }, returns: b.string.utf8 });
export const withPrototype = b.fn({ args: { prototype: b.object }, returns: WebElement, ...heap });
export const interfaceObject = b.fn({ args: { name: b.DOMString.impl }, returns: b.any, ...heap });
export const callFilter = b.fn({ args: { filter: b.object }, returns: b.any, capability: "js", throws: true });
export const crop = b.operation(
  { args: { target: WebTarget }, returns: b.i32, rustPath: `${path}::crop_nothing` },
  { args: { target: WebTarget, x: b.i32.wrap, y: b.i32.wrap }, returns: b.i32, rustPath: `${path}::crop` },
);
export const pointOfRealm = b.fn({ args: { to: WebPoint.nullable }, returns: WebPoint.nullable, ...heap });
export const describeMixed = b.fn({ args: { value: WebMixed }, returns: b.string.utf8, ...heap });
export const reversed = b.fn({
  args: { values: b.sequence(b.sequence(WebNodeOrString)), modes: b.sequence(WebMode).default([]) },
  returns: b.frozenArray(b.any),
  ...heap,
});
