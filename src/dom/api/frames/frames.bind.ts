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

export const Frame = b.interface("Frame", {
  membersInTable: false,
  rustPath: "crate::api::frames::Frame",
  noInterfaceObject: true,
  internalFields: ["element", "outer", "inner", "peer", "window"],
  proto: {},
});

const ui = Ui;
