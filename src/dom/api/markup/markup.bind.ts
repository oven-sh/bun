import * as b from "../../../codegen/bindgen-lib.ts";
import { DomElement, Node, SetHTMLOptions, ShadowRoot } from "../core/core.bind.ts";

export default b.module({
  rustPath: "crate::api::markup",
  ceReactions: "crate::api::core::custom",
  feature: "Desktop",
  membersInTable: false,
  isCold: true,
});

const js = { capability: "js", throws: true } as const;
const ce = { ...js, ceReactions: true } as const;
const webidl = { webidl: true } as const;
const node = b.ref("Node");
const doc = b.ref("Doc");
const string = b.DOMString;

export const GetHTMLOptions = b.dictionary(
  { serializableShadowRoots: b.bool.loose.default(false), shadowRoots: b.sequence(ShadowRoot).default([]) },
  webidl,
);
export const SetHTMLUnsafeOptions = b.dictionary(
  { runScripts: b.bool.loose.default(false), sanitizer: b.any.omittable },
  webidl,
);

export const Markup = b.mixin("Markup", {
  on: Node,
  proto: {
    getHTML: { args: { options: GetHTMLOptions.default({}) }, returns: string, rustName: "get_html", capability: "js" },
    setHTML: { args: { html: string, options: SetHTMLOptions.default({}) }, rustName: "set_html", ...ce },
    setHTMLUnsafe: {
      args: { html: b.any, options: SetHTMLUnsafeOptions.default({}) },
      rustName: "set_html_unsafe",
      ...ce,
    },
  },
});
b.include(DomElement, Markup);
b.include(ShadowRoot, Markup);

export const DOMParserSupportedType = b.enumeration({
  Html: "text/html",
  TextXml: "text/xml",
  Xml: "application/xml",
  Xhtml: "application/xhtml+xml",
  Svg: "image/svg+xml",
});

export const DOMParser = b.interface("DOMParser", {
  exposed: ["Window"],
  internalFields: { document: doc },
  construct: { passStructure: true, ...js },
  proto: { parseFromString: { args: { string: b.any, type: DOMParserSupportedType }, returns: doc, ...js } },
});

export const XMLSerializer = b.interface("XMLSerializer", {
  exposed: ["Window"],
  construct: {},
  proto: { serializeToString: { args: { root: node }, returns: string, ...js } },
});

const changes = (name: string) => ({ args: { [name]: b.any }, returns: b.bool, ...js });
const sets = { args: { allow: b.bool.loose }, returns: b.bool };

export const Sanitizer = b.interface("Sanitizer", {
  exposed: ["Window"],
  rustPath: "crate::api::markup::Sanitizer",
  construct: { args: { configuration: b.any.omittable }, ...js },
  proto: {
    get: { returns: b.any, ...js },
    allowElement: changes("element"),
    removeElement: changes("element"),
    replaceElementWithChildren: changes("element"),
    allowProcessingInstruction: changes("pi"),
    removeProcessingInstruction: changes("pi"),
    allowAttribute: changes("attribute"),
    removeAttribute: changes("attribute"),
    setComments: sets,
    setDataAttributes: sets,
    setJavascriptURLs: { ...sets, rustName: "set_javascript_urls" },
    removeUnsafe: { returns: b.bool },
  },
});

export const DocumentParser = b.interface("DocumentParser", {
  rustPath: "crate::api::markup::DocumentParser",
  noInterfaceObject: true,
  internalFields: { document: doc, kept: b.any },
});
