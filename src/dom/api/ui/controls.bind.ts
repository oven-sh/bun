import * as b from "../../../codegen/bindgen-lib.ts";
import { Node } from "../core/core.bind.ts";
import { Found } from "../find/find.bind.ts";
import { HTMLInputElement } from "../forms/forms.bind.ts";
import { DomWindow } from "../window/window.bind.ts";

export default b.module({
  rustPath: "crate::api::ui::controls",
  feature: "Desktop",
  membersInTable: false,
  isCold: true,
});

const Doc = b.ref("Doc");
const runs = { capability: "js" } as const;
const throws = { capability: "js", throws: true } as const;
const string = b.DOMString.impl.as("crate::api::core::DomString");
const text = b.DOMString.utf8;
const flag = (byDefault: boolean) => b.bool.loose.default(byDefault);

export const FindOptions = b.dictionary(
  { findNext: flag(true), forward: flag(true), matchCase: flag(false) },
  { webidl: true, fromHost: true },
);

export const PageForTests = b.dictionary(
  { fontScope: b.u32.wrap.optional, surface: b.u32.wrap.default(0) },
  { webidl: true },
);

/** For what is in the same process as the page. The rest is in `bun_web::page`. */
export const PageControls = b.interface("PageControls", {
  rustPath: "crate::api::ui::controls::PageControls",
  noInterfaceObject: true,
  internalFields: { window: DomWindow },
  proto: {
    id: { getter: b.u32 },
    resize: { args: { width: b.f64.loose, height: b.f64.loose, scale: b.f64.loose }, ...runs },
    loadHTML: { args: { source: b.DOMString }, rustName: "load_html", ...throws },
    /** What the host calls the page in it, or 0. */
    selectFrame: { args: { selector: b.DOMString }, returns: b.u32, ...throws },
    edit: { args: { name: text }, ...runs },
    render: runs,
    environmentChanged: runs,
    window: { getter: b.any },
    document: { getter: Doc },
    currentDocument: { returns: Doc },
    readyState: { returns: b.DOMString.atom.as("crate::api::core::Atom") },
    /** Without scripts, and without a `load` event. */
    confine: {},
    parseHTML: { args: { source: b.DOMString }, rustName: "parse_html", ...throws },
    flushCanvases: runs,
    attach: { args: { surface: b.u32 }, ...runs },
    dispose: runs,
    setUrl: { args: { url: string } },
    insertCSS: { args: { css: text, isOfUser: flag(false) }, returns: b.string.utf8, rustName: "insert_css", ...runs },
    removeInsertedCSS: { args: { key: b.u32.wrap }, rustName: "remove_inserted_css", ...runs },
    find: { args: { text, options: FindOptions.default({}) }, returns: Found, ...runs },
    stopFind: { args: { action: text.default("clearSelection") }, ...runs },
    chooseFiles: { args: { input: HTMLInputElement, chosen: b.sequence(b.any) }, ...runs },
    describeForAccessibility: { args: { node: Node }, returns: b.any, ...throws },
    /** JSON, for the DevTools protocol. */
    accessibilityTree: { returns: b.string.utf8, ...runs },
    selectionText: { returns: string, ...runs },
  },
});

/** For tests. */
export const createPage = b.fn({
  args: { page: PageForTests },
  returns: PageControls,
  ...runs,
});
