import * as b from "../../../codegen/bindgen-lib.ts";
import { DomAgent } from "./observers.bind.ts";

export default b.module({
  rustPath: "crate::api::core::custom",
  ceReactions: "crate::api::core::custom",
  feature: "Desktop",
  membersInTable: false,
  isCold: true,
});

const heap = { capability: "heap" } as const;
const js = { capability: "js", throws: true } as const;
const name = b.DOMString.atom;

export const reactLater = b.fn({
  args: { agent: DomAgent },
  capability: "js",
  export: "Bun__DOM__reactLater",
  feature: "Desktop",
});

export const CustomElementDefinition = b.interface("CustomElementDefinition", {
  noInterfaceObject: true,
  rustPath: "crate::api::core::custom::Definition",
  /** `stack` has the elements that are being upgraded, and null for one that is constructed. */
  internalFields: { registry: b.ref("CustomElementRegistry"), constructor: b.any, callbacks: b.any, stack: b.any },
  proto: {},
});

export const ElementDefinitionOptions = b.dictionary({ extends: name.optional }, { webidl: true });

export const CustomElementRegistry = b.interface("CustomElementRegistry", {
  rustPath: "crate::api::core::custom::Registry",
  /** `doc` is empty for a scoped one. */
  internalFields: { doc: b.ref("Doc"), definitions: b.any, classes: b.any, scopedDocs: b.any, promises: b.any },
  construct: { passStructure: true, ...heap },
  proto: {
    define: {
      args: { name, constructor: b.callable, options: ElementDefinitionOptions.default({}) },
      ceReactions: true,
      ...js,
    },
    get: { args: { name }, returns: b.any, ...heap },
    getName: { args: { constructor: b.callable }, returns: b.DOMString.nullable, ...heap },
    whenDefined: { args: { name }, returns: b.any, rejects: true, ...js },
    upgrade: { args: { root: b.ref("Node") }, ceReactions: true, rustName: "js_upgrade", ...heap },
    initialize: { args: { root: b.ref("Node") }, ceReactions: true, throws: true, ...heap },
  },
});

export const CustomStateSet = b.interface("CustomStateSet", {
  internalFields: { element: b.ref("DomElement") },
  setlike: { value: b.DOMString },
  proto: {
    add: { args: { value: b.DOMString }, returns: b.ref("CustomStateSet"), ...js },
    delete: { args: { value: b.DOMString }, returns: b.bool, ...js },
    clear: js,
  },
});
