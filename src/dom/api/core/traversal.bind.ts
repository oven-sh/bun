import * as b from "../../../codegen/bindgen-lib.ts";
import { Doc, Node } from "./core.bind.ts";

export default b.module({
  rustPath: "crate::api::core::traversal",
  feature: "Desktop",
  membersInTable: false,
  isCold: true,
});

const moves = { returns: Node.nullable, capability: "js", throws: true } as const;

export const NodeFilter = b.interface("NodeFilter", {
  callbackInterface: true,
  constants: {
    FILTER_ACCEPT: 1,
    FILTER_REJECT: 2,
    FILTER_SKIP: 3,
    SHOW_ALL: 0xffffffff,
    SHOW_ELEMENT: 0x1,
    SHOW_ATTRIBUTE: 0x2,
    SHOW_TEXT: 0x4,
    SHOW_CDATA_SECTION: 0x8,
    SHOW_ENTITY_REFERENCE: 0x10,
    SHOW_ENTITY: 0x20,
    SHOW_PROCESSING_INSTRUCTION: 0x40,
    SHOW_COMMENT: 0x80,
    SHOW_DOCUMENT: 0x100,
    SHOW_DOCUMENT_TYPE: 0x200,
    SHOW_DOCUMENT_FRAGMENT: 0x400,
    SHOW_NOTATION: 0x800,
  },
});

export const Traversal = b.interface("Traversal", {
  abstract: true,
  rustPath: "crate::api::core::traversal::Traversal",
  size: 8,
  internalFields: { root: Node, node: Node, candidate: Node, filter: b.any },
});

export const Traverses = b.mixin("Traverses", {
  on: Traversal,
  proto: {
    root: { getter: Node, field: "root" },
    whatToShow: { getter: b.u32 },
    filter: { getter: b.any, field: "filter" },
  },
});

export const NodeIterator = b.interface("NodeIterator", {
  extends: Traversal,
  includes: [Traverses],
  proto: {
    referenceNode: { getter: Node, field: "node" },
    pointerBeforeReferenceNode: { getter: b.bool },
    nextNode: moves,
    previousNode: moves,
    detach: {},
  },
});

export const TreeWalker = b.interface("TreeWalker", {
  extends: Traversal,
  includes: [Traverses],
  proto: {
    currentNode: { getter: Node, setter: true },
    parentNode: moves,
    firstChild: moves,
    lastChild: moves,
    previousSibling: moves,
    nextSibling: moves,
    previousNode: moves,
    nextNode: moves,
  },
});

const args = { root: Node, whatToShow: b.u32.wrap.default(0xffffffff), filter: b.object.nullable.optional };
export const DocumentTraversal = b.partial("DocumentTraversal", {
  on: Doc,
  proto: {
    createNodeIterator: { args, returns: NodeIterator, capability: "heap" },
    createTreeWalker: { args, returns: TreeWalker, capability: "heap" },
  },
});
