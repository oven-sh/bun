import * as b from "../../../codegen/bindgen-lib.ts";
import { DomElement } from "../core/core.bind.ts";
import { HTMLLinkElement, HTMLStyleElement } from "../core/html.bind.ts";
import { SVGStyleElement } from "../svg/svg.bind.ts";
import { WorkerGlobalScope } from "../window/window.bind.ts";

export default b.module({ rustPath: "crate::api::loading::bridge", feature: "Desktop", isCold: true });

const heap = { capability: "heap" } as const;
const runs = { capability: "js" } as const;
const js = { capability: "js", throws: true } as const;

export const LinkStyle = b.mixin("LinkStyle", {
  on: DomElement,
  proto: { sheet: { getter: b.ref("CSSStyleSheet").nullable, ...heap } },
});
for (const it of [HTMLLinkElement, HTMLStyleElement, SVGStyleElement]) b.include(it, LinkStyle);

export const OwnStyle = b.mixin("OwnStyle", {
  on: DomElement,
  proto: { disabled: { getter: b.bool, setter: { type: b.bool.loose }, ...runs } },
});
for (const it of [HTMLStyleElement, SVGStyleElement]) b.include(it, OwnStyle);

export const ImportingScope = b.mixin("ImportingScope", {
  on: WorkerGlobalScope,
  proto: { importScripts: { args: { urls: b.rest(b.any) }, ...js } },
});
b.include(WorkerGlobalScope, ImportingScope);
