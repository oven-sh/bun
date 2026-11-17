import * as b from "../../../codegen/bindgen-lib.ts";
import { Node } from "../core/core.bind.ts";
import { DomAgent } from "../core/observers.bind.ts";
import { Found } from "../find/find.bind.ts";
import { HTMLInputElement } from "../forms/forms.bind.ts";
import { NavigateRequest, NavigationType } from "../history/history.bind.ts";
import { DomWindow } from "../window/window.bind.ts";
import { NativeKind } from "./interaction.bind.ts";

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

export const NativeEvent = b.dictionary({ t: NativeKind }, { webidl: true, fromHost: true, fromJS: true });
export const FindOptions = b.dictionary(
  { findNext: flag(true), forward: flag(true), matchCase: flag(false) },
  { webidl: true, fromHost: true },
);

/** What hosts a page calls these. */
export const PageControls = b.interface("PageControls", {
  rustPath: "crate::api::ui::controls::PageControls",
  noInterfaceObject: true,
  internalFields: { window: DomWindow },
  proto: {
    handleEvent: { args: { event: b.object }, ...throws },
    render: runs,
    environmentChanged: runs,
    onlineChanged: { args: { isOnline: b.bool }, ...runs },
    window: { getter: b.any },
    currentWindow: { returns: b.any },
    document: { getter: Doc },
    currentDocument: { returns: Doc },
    readyState: { returns: b.DOMString.atom.as("crate::api::core::Atom") },
    loadHTML: { args: { source: b.DOMString, goesOn: b.bool.default(false) }, rustName: "load_html", ...throws },
    /** False if the document does not want more. */
    appendHTML: { args: { source: b.DOMString }, returns: b.bool, rustName: "append_html", ...throws },
    setEncoding: { args: { name: string }, rustName: "set_encoding" },
    endHTML: { args: { isComplete: b.bool }, rustName: "end_html", ...runs },
    loadXML: { args: { source: b.DOMString, contentType: string }, rustName: "load_xml", ...throws },
    /** Without scripts, and without a `load` event. */
    confine: {},
    parseHTML: { args: { source: b.DOMString }, rustName: "parse_html", ...throws },
    cameWith: { args: { script: b.DOMString }, returns: b.bool, ...throws },
    flushCanvases: runs,
    attach: { args: { surface: b.u32 }, ...runs },
    dispose: runs,
    /** What the response says about the next document. */
    aboutChanged: { args: { about: b.object }, capability: "heap" },
    /** Another document for the same window. */
    renew: { args: { url: string, baseUrl: string.optional }, ...runs },
    setUrl: { args: { url: string } },
    /** For a page in another realm of the same origin. */
    shared: { returns: DomAgent },
    baseUrl: { returns: string },
    checkStyleAttributes: {},
    isActive: { returns: b.bool },
    hasBeenActive: { returns: b.bool },
    frames: { returns: b.sequence(b.any), ...runs },
    focusedFrame: { returns: b.any, ...runs },
    navigate: { args: { url: text, request: NavigateRequest, initiator: b.object, origin: text }, ...runs },
    crossOriginWindow: { args: { peer: b.object, existing: b.any.omittable }, returns: b.any, capability: "heap" },
    remoteWindow: { args: { peer: b.object }, returns: b.any, ...runs },
    popState: { args: { url: text, key: text.optional }, ...runs },
    willTraverse: {
      args: { key: text.optional, isByUser: flag(false), proceed: b.callable },
      returns: b.bool,
      ...runs,
    },
    keepEntries: { args: { keys: b.sequenceVec(b.DOMString.utf8.owned) }, ...runs },
    abortNavigation: runs,
    stop: runs,
    willSwap: { args: { type: NavigationType, to: b.any }, returns: b.u32, ...runs },
    /** False if the page wants to stay. */
    beforeUnload: { returns: b.bool, ...runs },
    edit: { args: { name: string }, ...runs },
    insertText: { args: { text: string }, ...runs },
    dictionaryChanged: runs,
    insertCSS: { args: { css: text }, returns: b.string.utf8, rustName: "insert_css", ...runs },
    removeInsertedCSS: { args: { key: b.u32.wrap }, rustName: "remove_inserted_css", ...runs },
    find: { args: { text, options: FindOptions.default({}) }, returns: Found, ...runs },
    stopFind: { args: { action: text.default("clearSelection") }, ...runs },
    chooseFiles: { args: { input: HTMLInputElement, chosen: b.sequence(b.any) }, ...runs },
    describeForAccessibility: { args: { node: Node }, returns: b.any, ...throws },
    /** JSON, for the DevTools protocol. */
    accessibilityTree: { returns: b.string.utf8, ...runs },
    selectionText: { returns: string, ...runs },
    hitInfo: { args: { x: b.f64.loose, y: b.f64.loose }, returns: b.any, ...throws },
  },
});

/** For tests. */
export const createPage = b.fn({
  args: { host: b.object },
  returns: PageControls,
  ...runs,
});
