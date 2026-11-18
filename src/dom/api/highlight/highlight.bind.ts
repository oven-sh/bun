import * as b from "../../../codegen/bindgen-lib.ts";
import { Doc } from "../core/core.bind.ts";
import { AbstractRange } from "../range/range.bind.ts";

export default b.module({ rustPath: "crate::api::highlight", feature: "Desktop", isCold: true, membersInTable: false });

const js = { capability: "js", throws: true } as const;
const runs = { capability: "js" } as const;
const webidl = { webidl: true } as const;

export const HighlightType = b.enumeration(["highlight", "spelling-error", "grammar-error"]);

export const Highlight = b.interface("Highlight", {
  exposed: ["Window"],
  rustPath: "crate::api::highlight::Highlight",
  internalFields: ["registries"],
  setlike: { value: AbstractRange },
  construct: { args: { initialRanges: b.rest(AbstractRange) }, passStructure: true, capability: "heap", throws: true },
  proto: {
    priority: { getter: b.i32.wrap, setter: true, ...runs },
    type: { getter: HighlightType, setter: true, ignoreInvalid: true, rustName: "kind" },
    add: { args: { value: AbstractRange }, returns: b.ref("Highlight"), ...js },
    delete: { args: { value: AbstractRange }, returns: b.bool, ...js },
    clear: js,
  },
});

export const HighlightsFromPointOptions = b.dictionary(
  { shadowRoots: b.sequence(b.ref("ShadowRoot")).optional },
  webidl,
);
export const HighlightHitResult = b.dictionary({ highlight: Highlight, ranges: b.any }, { ...webidl, intoJS: true });

export const HighlightRegistry = b.interface("HighlightRegistry", {
  exposed: ["Window"],
  rustPath: "crate::api::highlight::HighlightRegistry",
  internalFields: { document: Doc },
  maplike: { key: b.DOMString, value: Highlight },
  proto: {
    set: { args: { key: b.DOMString, value: Highlight }, returns: b.ref("HighlightRegistry"), ...js },
    delete: { args: { key: b.DOMString }, returns: b.bool, ...js },
    clear: js,
    highlightsFromPoint: {
      args: { x: b.float, y: b.float, options: HighlightsFromPointOptions.default({}) },
      returns: b.any,
      ...js,
    },
  },
});
