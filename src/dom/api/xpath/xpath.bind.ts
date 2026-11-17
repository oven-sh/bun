import * as b from "../../../codegen/bindgen-lib.ts";
import { Doc } from "../core/core.bind.ts";

export default b.module({ rustPath: "crate::api::xpath", feature: "Desktop", membersInTable: false, isCold: true });

const allocates = { capability: "heap", throws: true } as const;
const js = { capability: "js", throws: true } as const;
const node = b.ref("Node");
const type = b.u16.wrap.default(0);
const reused = b.ref("XPathResult").nullable.optional;
const resolver = b.object.nullable.optional;

export const XPathResult = b.interface("XPathResult", {
  exposed: ["Window"],
  rustPath: "crate::api::xpath::XPathResult",
  internalFields: { document: b.ref("Doc"), nodes: b.any },
  constants: {
    ANY_TYPE: 0,
    NUMBER_TYPE: 1,
    STRING_TYPE: 2,
    BOOLEAN_TYPE: 3,
    UNORDERED_NODE_ITERATOR_TYPE: 4,
    ORDERED_NODE_ITERATOR_TYPE: 5,
    UNORDERED_NODE_SNAPSHOT_TYPE: 6,
    ORDERED_NODE_SNAPSHOT_TYPE: 7,
    ANY_UNORDERED_NODE_TYPE: 8,
    FIRST_ORDERED_NODE_TYPE: 9,
  },
  proto: {
    resultType: { getter: b.u16 },
    numberValue: { getter: b.f64, ...allocates },
    stringValue: { getter: b.DOMString, ...allocates },
    booleanValue: { getter: b.bool, ...allocates },
    singleNodeValue: { getter: node.nullable, ...allocates },
    invalidIteratorState: { getter: b.bool },
    snapshotLength: { getter: b.u32, ...allocates },
    iterateNext: { returns: node.nullable, ...allocates },
    snapshotItem: { args: { index: b.u32.wrap }, returns: node.nullable, ...allocates },
  },
});

export const XPathExpression = b.interface("XPathExpression", {
  exposed: ["Window"],
  rustPath: "crate::api::xpath::XPathExpression",
  proto: { evaluate: { args: { contextNode: node, type, reused }, returns: XPathResult, ...js } },
});

const evaluatorBase = {
  createExpression: { args: { expression: b.DOMString, resolver }, returns: XPathExpression, ...js },
  createNSResolver: { args: { nodeResolver: node }, returns: node, rustName: "create_ns_resolver" },
  evaluate: {
    args: { expression: b.DOMString, contextNode: node, resolver, type, reused },
    returns: XPathResult,
    ...js,
  },
} as const;

export const XPathEvaluator = b.interface("XPathEvaluator", {
  exposed: ["Window"],
  construct: {},
  proto: evaluatorBase,
});
export const DocumentXPath = b.partial("DocumentXPath", { on: Doc, proto: evaluatorBase });
