import * as b from "../../../codegen/bindgen-lib.ts";

export default b.module({
  rustPath: "crate::api::core::observers",
  feature: "Desktop",
  membersInTable: false,
  isCold: true,
});

const heap = { capability: "heap" } as const;
const node = b.ref("Node");
const flag = b.bool.loose.optional;

/** <https://html.spec.whatwg.org/#similar-origin-window-agent> */
export const DomAgent = b.interface("DomAgent", {
  noInterfaceObject: true,
  rustPath: "crate::api::core::Agent",
  internalFields: ["window", "scratch", "observers", "slots", "notify", "react", "constructing"],
  proto: {},
});
export const notifyObservers = b.fn({
  args: { agent: DomAgent },
  capability: "js",
  export: "Bun__DOM__notifyObservers",
  feature: "Desktop",
});

export const MutationObserverInit = b.dictionary(
  {
    attributeFilter: b.sequence(b.DOMString.atom).optional,
    attributeOldValue: flag,
    attributes: flag,
    characterData: flag,
    characterDataOldValue: flag,
    childList: b.bool.loose.default(false),
    subtree: b.bool.loose.default(false),
  },
  { webidl: true },
);

export const MutationObserver = b.interface("MutationObserver", {
  rustPath: "crate::api::core::MutationObserver",
  aliases: ["WebKitMutationObserver"],
  /** `link` is what the nodes hold: an array of the observer, which `disconnect` empties. */
  internalFields: ["callback", "records", "transient", "link"],
  construct: { args: { callback: b.callable }, passStructure: true, ...heap },
  proto: {
    observe: { args: { target: node, options: MutationObserverInit.default({}) }, throws: true, ...heap },
    disconnect: heap,
    takeRecords: { returns: b.any.returning("Array"), ...heap },
  },
});

export const MutationRecord = b.interface("MutationRecord", {
  rustPath: "crate::api::core::MutationRecord",
  /** `added` and `removed` are a node, or an array, until they are read. */
  internalFields: { target: node, previous: node, next: node, added: b.any, removed: b.any },
  proto: {
    type: { getter: b.DOMString, ...heap },
    target: { getter: node, field: "target" },
    addedNodes: { getter: b.any, ...heap },
    removedNodes: { getter: b.any, ...heap },
    previousSibling: { getter: node.nullable, field: "previous" },
    nextSibling: { getter: node.nullable, field: "next" },
    attributeName: { getter: b.DOMString.nullable, ...heap },
    attributeNamespace: { getter: b.DOMString.nullable, ...heap },
    oldValue: { getter: b.DOMString.nullable, ...heap },
  },
});
