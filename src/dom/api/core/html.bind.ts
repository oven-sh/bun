import * as b from "../../../codegen/bindgen-lib.ts";
import { DomElement } from "./core.bind.ts";
import { htmlConstructor, reflect, tokenList } from "./reflect.ts";

export default b.module({
  rustPath: "crate::api::core::html",
  ceReactions: "crate::api::core::custom",
  feature: "Desktop",
  membersInTable: false,
  isCold: true,
});

const heap = { capability: "heap" } as const;
const runs = { capability: "js" } as const;
const js = { capability: "js", throws: true } as const;
const reacts = { ...runs, ceReactions: true } as const;
const ce = { ...js, ceReactions: true } as const;
const string = b.DOMString.impl.as("crate::api::core::DomString");
const usvString = b.USVString.impl.as("crate::api::core::DomString");
const nullToEmpty = b.DOMString.nullToEmpty.impl.as("crate::api::core::DomString");
const collection = { getter: b.any.returning("HTMLCollection"), ...heap } as const;
const index = b.i32.wrap;

export const HTMLOrSVGElement = b.mixin("HTMLOrSVGElement", {
  on: DomElement,
  proto: {
    dataset: { getter: b.any.returning("DOMStringMap"), ...heap },
    nonce: { getter: string, setter: true },
  },
});

export const Hidden = b.union(
  { none: b.null, flag: b.bool.loose, number: b.f64.loose, text: b.DOMString.impl },
  { webidl: true },
);

export const HTMLElement = b.interface("HTMLElement", {
  membersInTable: true,
  extends: DomElement,
  includes: [HTMLOrSVGElement],
  ...htmlConstructor,
  proto: {
    ...reflect("title lang dir accessKey inert? enterKeyHint inputMode virtualKeyboardPolicy"),
    translate: { getter: b.bool, setter: { type: b.bool.loose, ...runs }, ceReactions: true },
    hidden: {
      getter: b.any.returning("boolean", "string"),
      setter: { type: Hidden, ...runs },
      ceReactions: true,
      ...heap,
    },
    innerText: { getter: string, setter: { type: nullToEmpty }, ...reacts },
    outerText: { getter: string, setter: { type: b.DOMString.nullToEmpty.impl, throws: true }, ...reacts },
  },
});
export const MathMLElement = b.interface("MathMLElement", { extends: DomElement, includes: [HTMLOrSVGElement] });

const element = (name: string, reflected = "", proto: object = {}, rest: object = {}) =>
  b.interface(name, { extends: HTMLElement, ...htmlConstructor, proto: { ...reflect(reflected), ...proto }, ...rest });

export const HTMLUnknownElement = b.interface("HTMLUnknownElement", { extends: HTMLElement });
export const HTMLBRElement = element("HTMLBRElement", "clear");
export const HTMLBodyElement = element("HTMLBodyElement", "text link vLink aLink bgColor background");
export const HTMLDListElement = element("HTMLDListElement", "compact?");
export const HTMLDataElement = element("HTMLDataElement", "value");
export const HTMLDirectoryElement = element("HTMLDirectoryElement", "compact?");
export const HTMLDivElement = element("HTMLDivElement", "align");
export const HTMLFontElement = element("HTMLFontElement", "color! face size");
export const HTMLFrameSetElement = element("HTMLFrameSetElement", "cols rows");
export const HTMLHRElement = element("HTMLHRElement", "align color noShade? size width");
export const HTMLHeadElement = element("HTMLHeadElement");
export const HTMLHeadingElement = element("HTMLHeadingElement", "align");
export const HTMLHtmlElement = element("HTMLHtmlElement", "version");
export const HTMLLIElement = element("HTMLLIElement", "value=0 type");
export const HTMLMenuElement = element("HTMLMenuElement", "compact?");
export const HTMLMetaElement = element("HTMLMetaElement", "name httpEquiv content media scheme");
export const HTMLModElement = element("HTMLModElement", "cite@ dateTime");
export const HTMLOListElement = element("HTMLOListElement", "reversed? start=1 type compact?");
export const HTMLParagraphElement = element("HTMLParagraphElement", "align");
export const HTMLParamElement = element("HTMLParamElement", "name value type valueType");
export const HTMLPictureElement = element("HTMLPictureElement");
export const HTMLPreElement = element("HTMLPreElement", "width=0");
export const HTMLQuoteElement = element("HTMLQuoteElement", "cite@");
export const HTMLSpanElement = element("HTMLSpanElement");
export const HTMLTimeElement = element("HTMLTimeElement", "dateTime");
export const HTMLUListElement = element("HTMLUListElement", "compact? type");

export const HTMLMarqueeElement = element(
  "HTMLMarqueeElement",
  "behavior bgColor~ direction height width hspace+0 vspace+0 scrollAmount+6 scrollDelay+85 trueSpeed?",
  { loop: { getter: b.i32, setter: { type: b.i32.wrap, ...js }, ceReactions: true }, start: {}, stop: {} },
);

export const HTMLObjectElement = element(
  "HTMLObjectElement",
  "data^ type name useMap width height align archive code declare? hspace+0 standby vspace+0 codeBase^ codeType border!",
);

export const HTMLEmbedElement = element("HTMLEmbedElement", "src^ type width height align name");
export const HTMLFrameElement = element(
  "HTMLFrameElement",
  "name scrolling src@ frameBorder longDesc@ noResize? marginHeight marginWidth",
);
export const HTMLIFrameElement = element(
  "HTMLIFrameElement",
  `src@ srcdoc% name allow allowFullscreen? width height referrerPolicy loading csp credentialless? align scrolling
  frameBorder longDesc@ marginHeight marginWidth`,
  {
    sandbox: tokenList(
      "sandbox",
      `allow-downloads allow-forms allow-modals allow-orientation-lock allow-pointer-lock allow-popups
      allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts
      allow-storage-access-by-user-activation allow-top-navigation allow-top-navigation-by-user-activation
      allow-top-navigation-to-custom-protocols`,
    ),
  },
);

const blocking = tokenList("blocking", "render");
export const HTMLStyleElement = element("HTMLStyleElement", "media type", { blocking });
export const HTMLLinkElement = element(
  "HTMLLinkElement",
  `href@ crossOrigin rel as media integrity hreflang type imageSrcset$ imageSizes referrerPolicy disabled? fetchPriority
  charset rev target`,
  {
    relList: tokenList(
      "rel",
      "preload preconnect dns-prefetch stylesheet icon alternate prefetch modulepreload manifest canonical expect",
    ),
    sizes: tokenList("sizes"),
    blocking,
  },
);
const source = { setter: { type: b.any, throws: true }, ...reacts } as const;
export const HTMLScriptElement = element(
  "HTMLScriptElement",
  "src^ type noModule? charset defer? crossOrigin integrity referrerPolicy fetchPriority event htmlFor",
  {
    async: {
      getter: b.bool,
      setter: { type: b.bool.loose, capability: "js" },
      ceReactions: true,
      rustName: "is_async",
    },
    blocking,
    text: { getter: string, ...source },
    textContent: { getter: string, ...source },
    innerText: { getter: string, ...source },
  },
  { static: { supports: { args: { type: b.string.utf8 }, returns: b.bool } } },
);

export const HTMLMapElement = element("HTMLMapElement", "name", { areas: collection });

export const ChildText = b.mixin("ChildText", {
  on: DomElement,
  proto: { text: { getter: string, setter: runs, ceReactions: true } },
});
export const HTMLTitleElement = element("HTMLTitleElement", "", {}, { includes: [ChildText] });

export const HTMLBaseElement = element("HTMLBaseElement", "target", {
  href: { getter: usvString, setter: runs, ceReactions: true, ...heap },
});

export const HTMLTemplateElement = element(
  "HTMLTemplateElement",
  "shadowRootMode shadowRootDelegatesFocus? shadowRootClonable? shadowRootSerializable? shadowRootCustomElementRegistry shadowRootSlotAssignment htmlFor",
  { content: { getter: b.ref("DocumentFragment"), ...runs } },
);

export const AssignedNodesOptions = b.dictionary({ flatten: b.bool.loose.default(false) }, { webidl: true });
export const ElementOrText = b.union({ element: DomElement, text: b.ref("Text") }, { webidl: true });
const assigned = {
  args: { options: AssignedNodesOptions.default({}) },
  returns: b.any.returning("Array"),
  ...heap,
} as const;
export const HTMLSlotElement = element("HTMLSlotElement", "name", {
  assignedNodes: { ...assigned, rustName: "js_assigned_nodes" },
  assignedElements: assigned,
  assign: { args: { nodes: b.rest(ElementOrText) }, ...runs },
});

export const UrlPart = b.family("UrlPart", {
  on: DomElement,
  key: "crate::api::core::url::Part",
  getter: usvString,
  setter: { type: b.USVString.impl },
  ...reacts,
});
export const HyperlinkElementUtils = b.mixin("HyperlinkElementUtils", {
  on: DomElement,
  proto: {
    href: { getter: usvString, setter: true, stringifier: true, ...reacts },
    origin: { getter: b.any.returning("string"), ...js },
    ...Object.fromEntries(
      ["Protocol", "Username", "Password", "Host", "Hostname", "Port", "Pathname", "Search", "Hash"].map(part => [
        part.toLowerCase(),
        UrlPart.of(`crate::api::core::url::Part::${part}`),
      ]),
    ),
  },
});
const link = { includes: [HyperlinkElementUtils] };
const relList = tokenList("rel", "noreferrer noopener opener");
export const HTMLAnchorElement = element(
  "HTMLAnchorElement",
  "target download ping$ rel hreflang type referrerPolicy coords charset name rev shape",
  { relList, text: { getter: string, setter: runs, ceReactions: true } },
  link,
);
export const HTMLAreaElement = element(
  "HTMLAreaElement",
  "alt coords shape target download ping$ rel referrerPolicy noHref?",
  { relList },
  link,
);

const cellAlignment = "align ch chOff vAlign";
export const HTMLTableCaptionElement = element("HTMLTableCaptionElement", "align");
export const HTMLTableColElement = element("HTMLTableColElement", `span>1 width ${cellAlignment}`);
export const HTMLTableCellElement = element(
  "HTMLTableCellElement",
  `colSpan>1 rowSpan+1 headers scope abbr axis height width noWrap? bgColor ${cellAlignment}`,
  { cellIndex: { getter: b.i32 } },
);
const inserts = { args: { index: index.default(-1) }, returns: DomElement, ...js } as const;
const deletes = { args: { index }, ...ce } as const;
export const HTMLTableRowElement = element("HTMLTableRowElement", `bgColor ${cellAlignment}`, {
  rowIndex: { getter: b.i32, ...heap },
  sectionRowIndex: { getter: b.i32, ...heap },
  cells: collection,
  insertCell: inserts,
  deleteCell: deletes,
});
export const HTMLTableSectionElement = element("HTMLTableSectionElement", cellAlignment, {
  rows: collection,
  insertRow: inserts,
  deleteRow: deletes,
});
const part = (type: any) =>
  ({ getter: DomElement.nullable, setter: { type: type.nullable, ...js }, ceReactions: true }) as const;
const creates = { returns: DomElement, ...runs } as const;
export const HTMLTableElement = element(
  "HTMLTableElement",
  "align border frame rules summary width bgColor cellPadding cellSpacing",
  {
    caption: part(HTMLTableCaptionElement),
    createCaption: creates,
    deleteCaption: reacts,
    tHead: { ...part(HTMLTableSectionElement), rustName: "thead" },
    createTHead: { ...creates, rustName: "create_thead" },
    deleteTHead: { ...reacts, rustName: "delete_thead" },
    tFoot: { ...part(HTMLTableSectionElement), rustName: "tfoot" },
    createTFoot: { ...creates, rustName: "create_tfoot" },
    deleteTFoot: { ...reacts, rustName: "delete_tfoot" },
    tBodies: { ...collection, rustName: "tbodies" },
    createTBody: { ...creates, rustName: "create_tbody" },
    rows: collection,
    insertRow: inserts,
    deleteRow: deletes,
  },
);
