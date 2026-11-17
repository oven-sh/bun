import * as b from "../../../codegen/bindgen-lib.ts";
import { DesktopEventTarget, Doc } from "../core/core.bind.ts";
import { DesktopEvent, DesktopEventInit, OnEvent } from "../events/events.bind.ts";

export default b.module({ rustPath: "crate::api::fonts", feature: "Desktop", isCold: true, membersInTable: false });

const heap = { capability: "heap" } as const;
const runs = { capability: "js" } as const;
const js = { capability: "js", throws: true } as const;
const webidl = { webidl: true } as const;
const text = b.DOMString.utf8;
const exposed = ["Window", "Worker"] as const;

const descriptors = `style weight stretch unicodeRange variant featureSettings variationSettings display ascentOverride
  descentOverride lineGapOverride sizeAdjust`.split(/\s+/);
export const FontFaceDescriptors = b.dictionary(Object.fromEntries(descriptors.map(it => [it, text.optional])), webidl);
export const FontFaceLoadStatus = b.enumeration(["unloaded", "loading", "loaded", "error"]);
export const FontFaceSetLoadStatus = b.enumeration(["loading", "loaded"]);
export const FontSource = b.union({ binary: b.bufferSource, text }, webidl);

export const AnyFontFace = b.interface("AnyFontFace", {
  rustPath: "crate::api::fonts::AnyFontFace",
  abstract: true,
  internalFields: ["loaded", "sets"],
});
export const FontDescriptor = b.family("FontDescriptor", {
  on: AnyFontFace,
  key: "crate::font_face::Descriptor",
  getter: text,
  setter: true,
  ...js,
});

export const FontFace = b.interface("FontFace", {
  extends: AnyFontFace,
  exposed,
  construct: {
    args: { family: text, source: FontSource, descriptors: FontFaceDescriptors.default({}) },
    passStructure: true,
    ...js,
  },
  proto: {
    ...Object.fromEntries(
      ["family", ...descriptors].map(it => [
        it,
        FontDescriptor.of(`crate::font_face::Descriptor::${it[0].toUpperCase()}${it.slice(1)}`),
      ]),
    ),
    status: { getter: FontFaceLoadStatus },
    load: { returns: b.any, rejects: true, ...js },
    loaded: { getter: b.any, field: "loaded", rejects: true },
  },
});

const font = { font: FontFace };
const query = { font: text, text: b.USVString.utf8.default(" ") };
export const FontFaceSet = b.interface("FontFaceSet", {
  extends: DesktopEventTarget,
  rustPath: "crate::api::fonts::FontFaceSet",
  exposed,
  internalFields: { document: Doc, ofRules: b.any, loading: b.any, done: b.any, ready: b.any },
  setlike: { value: FontFace, prepare: true },
  proto: {
    add: { args: font, returns: b.ref("FontFaceSet"), ...js },
    delete: { args: font, returns: b.bool, ...js },
    clear: js,
    load: { args: query, returns: b.any, rejects: true, ...js },
    check: { args: query, returns: b.bool, ...js },
    ready: { getter: b.any, rejects: true, ...runs },
    status: { getter: FontFaceSetLoadStatus },
    ...Object.fromEntries(
      ["loading", "loadingdone", "loadingerror"].map(it => ["on" + it, OnEvent.of(`crate::api::core::atom!("${it}")`)]),
    ),
  },
});

export const FontFaceSetLoadEventInit = b.dictionary(
  { fontfaces: b.sequence(FontFace).optional },
  { webidl: true, extends: DesktopEventInit },
);
export const FontFaceSetLoadEvent = b.interface("FontFaceSetLoadEvent", {
  extends: DesktopEvent,
  rustPath: "crate::api::fonts::FontFaceSetLoadEvent",
  exposed,
  internalFields: ["fontfaces"],
  construct: {
    args: { type: b.DOMString.atom.as("crate::api::core::Atom"), init: FontFaceSetLoadEventInit.default({}) },
    passStructure: true,
    ...heap,
  },
  proto: { fontfaces: { getter: b.any, field: "fontfaces" } },
});

export const FontFaceSource = b.partial("FontFaceSource", {
  on: Doc,
  proto: { fonts: { getter: FontFaceSet, ...js } },
});
