import * as b from "../../../codegen/bindgen-lib.ts";
import { Doc } from "../core/core.bind.ts";

export default b.module({
  rustPath: "crate::api::range",
  ceReactions: "crate::api::core::custom",
  feature: "Desktop",
  membersInTable: false,
  isCold: true,
});

const heap = { capability: "heap" } as const;
const allocates = { capability: "heap", throws: true } as const;
const runs = { capability: "js" } as const;
const js = { capability: "js", throws: true } as const;
const ce = { ...js, ceReactions: true } as const;
const node = b.ref("Node");
const range = b.ref("Range");
const fragment = b.ref("DocumentFragment");
const offset = b.u32.wrap;
const string = b.DOMString;

export const AbstractRange = b.interface("AbstractRange", {
  exposed: ["Window"],
  rustPath: "crate::api::range::AbstractRange",
  /** `owner`: the selection of a `Range`, the control of an `OpaqueRange`. */
  internalFields: { start: node, end: node, owner: b.any },
  proto: {
    startContainer: { getter: node.nullable, field: "start" },
    startOffset: { getter: b.u32 },
    endContainer: { getter: node.nullable, field: "end" },
    endOffset: { getter: b.u32 },
    collapsed: { getter: b.bool },
  },
});

export const StaticRangeInit = b.dictionary(
  { endContainer: node, endOffset: offset, startContainer: node, startOffset: offset },
  { webidl: true },
);

export const StaticRange = b.interface("StaticRange", {
  exposed: ["Window"],
  extends: AbstractRange,
  construct: { args: { init: StaticRangeInit }, passStructure: true, ...allocates },
});

const rects = {
  getClientRects: { returns: b.any, ...js },
  getBoundingClientRect: { returns: b.any, ...js },
} as const;

export const OpaqueRange = b.interface("OpaqueRange", {
  exposed: ["Window"],
  extends: AbstractRange,
  proto: {
    startContainer: { getter: b.any, rustName: "container", ...heap },
    endContainer: { getter: b.any, rustName: "container", ...heap },
    disconnect: runs,
    ...rects,
  },
});

const toPoint = { args: { node, offset }, ...js };
const toNode = { args: { node }, ...js };

export const Range = b.interface("Range", {
  exposed: ["Window"],
  extends: AbstractRange,
  constants: { START_TO_START: 0, START_TO_END: 1, END_TO_END: 2, END_TO_START: 3 },
  construct: { passStructure: true, ...js },
  proto: {
    commonAncestorContainer: { getter: node },
    setStart: toPoint,
    setEnd: toPoint,
    setStartBefore: toNode,
    setStartAfter: toNode,
    setEndBefore: toNode,
    setEndAfter: toNode,
    collapse: { args: { toStart: b.bool.loose.default(false) }, ...runs },
    selectNode: toNode,
    selectNodeContents: toNode,
    compareBoundaryPoints: { args: { how: b.u16.wrap, sourceRange: range }, returns: b.i32, ...allocates },
    deleteContents: ce,
    extractContents: { returns: fragment, ...ce },
    cloneContents: { returns: fragment, ...ce },
    insertNode: { args: { node }, ...ce },
    surroundContents: { args: { newParent: node }, ...ce },
    cloneRange: { returns: range, ...heap },
    detach: {},
    isPointInRange: { args: { node, offset }, returns: b.bool, ...allocates },
    comparePoint: { args: { node, offset }, returns: b.i32, ...allocates },
    intersectsNode: { args: { node }, returns: b.bool },
    createContextualFragment: { args: { string: b.any }, returns: node, ...ce },
    ...rects,
    expand: { args: { unit: string.default("") }, ...runs },
    toString: { returns: string, rustName: "stringify", ...heap },
  },
});

export const DocumentRange = b.partial("DocumentRange", {
  on: Doc,
  proto: { createRange: { returns: range, ...heap } },
});

export const GetComposedRangesOptions = b.dictionary(
  { shadowRoots: b.sequence(b.ref("ShadowRoot")).default([]) },
  { webidl: true },
);

const collapse = { args: { node: node.nullable, offset: offset.default(0) }, rustName: "set_position", ...js };
const clear = { rustName: "clear", ...runs };

export const Selection = b.interface("Selection", {
  exposed: ["Window"],
  rustPath: "crate::api::range::Selection",
  /** `ofDocument`: the one that has the state, if `scope` is a shadow root. `composed`: if the ends are in different trees. */
  internalFields: { scope: node, ofDocument: b.ref("Selection"), range, composed: range },
  proto: {
    anchorNode: { getter: node.nullable },
    anchorOffset: { getter: b.u32 },
    focusNode: { getter: node.nullable },
    focusOffset: { getter: b.u32 },
    baseNode: { getter: node.nullable, rustName: "anchor_node" },
    baseOffset: { getter: b.u32, rustName: "anchor_offset" },
    extentNode: { getter: node.nullable, rustName: "focus_node" },
    extentOffset: { getter: b.u32, rustName: "focus_offset" },
    isCollapsed: { getter: b.bool },
    rangeCount: { getter: b.u32 },
    type: { getter: string, ...heap },
    direction: { getter: string, ...heap },
    getRangeAt: { args: { index: offset }, returns: range, ...allocates },
    getComposedRanges: {
      args: { options: GetComposedRangesOptions.default({}) },
      returns: b.sequence(StaticRange),
      ...heap,
    },
    addRange: { args: { range }, ...runs },
    removeRange: { args: { range }, ...js },
    removeAllRanges: clear,
    empty: clear,
    collapse,
    setPosition: collapse,
    collapseToStart: js,
    collapseToEnd: js,
    extend: { args: { node, offset: offset.default(0) }, ...js },
    setBaseAndExtent: { args: { anchorNode: node, anchorOffset: offset, focusNode: node, focusOffset: offset }, ...js },
    selectAllChildren: toNode,
    modify: {
      args: { alter: string.default(""), direction: string.default(""), granularity: string.default("") },
      ...js,
    },
    deleteFromDocument: ce,
    containsNode: { args: { node, allowPartialContainment: b.bool.loose.default(false) }, returns: b.bool },
    toString: { returns: b.any.returning("string"), rustName: "stringify", ...runs },
  },
});

const at = b.u32;
const ends = { startNode: node, startOffset: at, endNode: node, endOffset: at };
const selection = Selection;
