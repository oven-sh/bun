import * as b from "../../../codegen/bindgen-lib.ts";
import { Doc, DocumentType, DomElement, Node } from "./core.bind.ts";

export default b.module({
  rustPath: "crate::api::core::document_members",
  ceReactions: "crate::api::core::custom",
  feature: "Desktop",
  isCold: true,
});

const heap = { capability: "heap" } as const;
const allocates = { capability: "heap", throws: true } as const;
const runs = { capability: "js" } as const;
const js = { capability: "js", throws: true } as const;
const ce = { ...js, ceReactions: true } as const;
const string = b.DOMString.impl.as("crate::api::core::DomString");
const usvString = b.USVString.impl.as("crate::api::core::DomString");
const nullToEmpty = b.DOMString.nullToEmpty.impl.as("crate::api::core::DomString");
const atom = b.DOMString.atom.as("crate::api::core::Atom");

export const HTMLDocument = b.interface("HTMLDocument", { extends: Doc });
export const XMLDocument = b.interface("XMLDocument", { extends: Doc });

export const DOMImplementation = b.interface("DOMImplementation", {
  internalFields: { document: Doc },
  proto: {
    createDocumentType: { args: { name: atom, publicId: string, systemId: string }, returns: Node, ...allocates },
    createDocument: {
      args: {
        namespace: b.DOMString.nullable,
        qualifiedName: b.DOMString.nullToEmpty,
        doctype: DocumentType.nullable.optional,
      },
      returns: Doc,
      ...js,
    },
    createHTMLDocument: { args: { title: string.optional }, returns: Doc, rustName: "create_html_document", ...runs },
    hasFeature: { returns: b.bool },
  },
});

export const FragmentDirective = b.interface("FragmentDirective", {});

export const BodyColor = b.family("BodyColor", {
  on: Doc,
  key: "crate::api::core::Known",
  getter: string,
  setter: { type: nullToEmpty, ...runs },
  ceReactions: true,
});
const color = (attribute: string) => BodyColor.of(`crate::api::core::atom!("${attribute}")`);

export const ImportNodeOptions = b.dictionary(
  { customElementRegistry: b.object.optional, selfOnly: b.bool.loose.default(false) },
  { webidl: true },
);
export const SubtreeOrOptions = b.union({ subtree: b.bool.loose, options: ImportNodeOptions }, { webidl: true });
const encoding = { getter: string, rustName: "character_set" } as const;
const writes = { args: { text: b.rest(b.any) }, ...ce } as const;

export const DocumentMembers = b.partial("DocumentMembers", {
  on: Doc,
  proto: {
    implementation: { getter: b.any.returning("DOMImplementation"), shortcut: "implementationEdge", ...heap },
    URL: { getter: usvString, rustName: "url" },
    documentURI: { getter: usvString, rustName: "url" },
    compatMode: { getter: atom },
    characterSet: encoding,
    charset: encoding,
    inputEncoding: encoding,
    contentType: { getter: string },
    createProcessingInstruction: { args: { target: atom, data: string }, returns: Node, ...allocates },
    importNode: { args: { node: Node, options: SubtreeOrOptions.default(false) }, returns: Node, ...ce },
    adoptNode: { args: { node: Node }, returns: Node, ...ce },

    location: { getter: b.any, putForwards: "href", unforgeable: true, ...js },
    domain: { getter: string, setter: { type: b.USVString.utf8 }, ...js },
    referrer: { getter: string, ...heap },
    cookie: { getter: string, setter: { type: b.USVString.utf8 }, ...js },
    lastModified: { getter: string, ...js },
    readyState: { getter: atom },
    title: { getter: string, setter: runs, ceReactions: true },
    dir: { getter: atom, setter: { type: string, ...runs }, ceReactions: true },
    currentScript: { getter: Node.nullable },
    open: [
      { args: { unused1: b.DOMString.optional, unused2: b.DOMString.optional }, returns: Doc, ...ce },
      {
        args: { url: b.USVString, name: b.DOMString, features: b.DOMString },
        returns: b.any,
        rustName: "open_window",
        ...js,
      },
    ],
    close: ce,
    write: writes,
    writeln: writes,
    defaultView: { getter: b.any, ...heap },
    createEvent: { args: { interface: b.DOMString.utf8 }, returns: b.any, ...js },
    hasStorageAccess: { returns: b.any.returning("Promise"), rejects: true, ...js },
    requestStorageAccess: { returns: b.any.returning("Promise"), rejects: true, ...js },
    hidden: { getter: b.bool },
    visibilityState: { getter: atom },
    wasDiscarded: { getter: b.bool, rustName: "never" },
    prerendering: { getter: b.bool, rustName: "never" },
    fragmentDirective: { getter: b.any.returning("FragmentDirective"), ...heap },
    rootElement: { getter: DomElement.nullable },

    fgColor: color("text"),
    linkColor: color("link"),
    vlinkColor: color("vlink"),
    alinkColor: color("alink"),
    bgColor: color("bgcolor"),
    clear: { rustName: "do_nothing" },
    captureEvents: { rustName: "do_nothing" },
    releaseEvents: { rustName: "do_nothing" },
  },
});
