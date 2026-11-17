import * as b from "../../../codegen/bindgen-lib.ts";
import { DomElement } from "../core/core.bind.ts";
import { HTMLEmbedElement, HTMLFrameElement, HTMLIFrameElement, HTMLObjectElement } from "../core/html.bind.ts";
import { Ui } from "../ui/interaction.bind.ts";

export default b.module({
  rustPath: "crate::api::frames::entry",
  feature: "Desktop",
  isCold: true,
  membersInTable: false,
});

const runs = { capability: "js" } as const;
const string = b.DOMString.impl.as("crate::api::core::DomString");
const number = b.f64.loose;
const flag = b.bool.loose.default(false);
const numbers = b.array(b.f64);

export const FrameWindow = b.mixin("FrameWindow", {
  on: DomElement,
  proto: { contentWindow: { getter: b.any, ...runs }, contentDocument: { getter: b.any, ...runs } },
});
export const FrameSvgDocument = b.mixin("FrameSvgDocument", {
  on: DomElement,
  proto: { getSVGDocument: { returns: b.any, rustName: "svg_document", ...runs } },
});
for (const it of [HTMLFrameElement, HTMLIFrameElement, HTMLObjectElement]) b.include(it, FrameWindow);
for (const it of [HTMLEmbedElement, HTMLIFrameElement, HTMLObjectElement]) b.include(it, FrameSvgDocument);

/** What hosts the document of a frame calls these. */
export const Frame = b.interface("Frame", {
  membersInTable: false,
  rustPath: "crate::api::frames::Frame",
  noInterfaceObject: true,
  internalFields: ["element", "outer", "inner", "peer", "window"],
  proto: {
    self: { returns: DomElement, rustName: "element" },
    kind: { returns: string },
    name: { returns: string },
    isClosed: { getter: b.bool },
    length: { getter: b.u32 },
    attribute: { args: { name: b.DOMString.atom.as("crate::api::core::Atom") }, returns: string.nullable },
    resolve: { args: { url: string }, returns: string.nullable, ...runs },
    loading: runs,
    navigating: {},
    finished: { args: { fires: flag }, ...runs },
    loaded: { args: { length: b.u32.wrap }, ...runs },
    useWebEngine: { args: { url: string }, ...runs },
    showImage: { args: { url: string }, ...runs },
    painted: { args: { image: b.u32.wrap }, ...runs },
    measure: runs,
    scroll: { args: { x: number, y: number }, ...runs },
    fullscreen: { args: { on: flag }, ...runs },
    focus: runs,
    focusElement: runs,
    tab: { args: { direction: number }, ...runs },
    tooltip: { args: { text: string.nullable }, ...runs },
    isFocused: { returns: b.bool },
    origin: { returns: numbers },
    box: { returns: numbers, rustName: "area" },
    scale: { returns: b.f64, rustName: "surface_scale" },
  },
});

const ui = Ui;
