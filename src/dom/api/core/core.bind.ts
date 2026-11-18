import * as b from "../../../codegen/bindgen-lib.ts";
import * as table from "../../../codegen/builtins/lib.ts";

export default b.module({ rustPath: "crate::api::core", ceReactions: "crate::api::core::custom", feature: "Desktop" });

const heap = { capability: "heap" } as const;
const allocates = { capability: "heap", throws: true } as const;
const runs = { capability: "js" } as const;
const js = { capability: "js", throws: true } as const;
const ce = { ...js, ceReactions: true } as const;
const node = b.ref("Node");
const element = b.ref("DomElement");
const attr = b.ref("Attr");
const string = b.DOMString;
const offset = b.u32.wrap;
const nodes = { nodes: b.rest(b.any) };
const onlyReads = true;
const withoutFrame = true;
const reflected = { getter: string, setter: js, ceReactions: true, onlyReads, ...heap } as const;

export const DesktopEventListenerOptions = b.dictionary({ capture: b.bool.loose.default(false) }, { webidl: true });
export const DesktopAddEventListenerOptions = b.dictionary(
  { once: b.bool.loose.default(false), passive: b.bool.loose.optional, signal: b.any.omittable },
  { webidl: true, extends: DesktopEventListenerOptions },
);
export const EventListenerOptionsOrBoolean = b.union({ options: DesktopEventListenerOptions, capture: b.bool.loose });
export const AddEventListenerOptionsOrBoolean = b.union({
  options: DesktopAddEventListenerOptions,
  capture: b.bool.loose,
});
const listener = { type: b.DOMString.atom.as("crate::api::core::Atom"), callback: b.object.nullable };

export const DesktopEventTarget = b.interface("DesktopEventTarget", {
  name: "EventTarget",
  inlineCapacity: 2,
  internalFields: { listeners: b.ref("Listeners") },
  construct: {},
  proto: {
    addEventListener: {
      args: { ...listener, options: AddEventListenerOptionsOrBoolean.optional },
      otherReceivers: "Bun::jsDesktopAddEventListenerToOther",
      ...allocates,
    },
    removeEventListener: {
      args: { ...listener, options: EventListenerOptionsOrBoolean.optional },
      otherReceivers: "Bun::jsDesktopRemoveEventListenerFromOther",
      ...heap,
    },
    dispatchEvent: {
      args: { event: b.any },
      length: 1,
      returns: b.bool,
      otherReceivers: "Bun::jsDesktopDispatchEventToOther",
      ...js,
    },
  },
});

export const GetRootNodeOptions = b.dictionary({ composed: b.bool.loose.default(false) }, { webidl: true });

export const Node = b.interface("Node", {
  extends: DesktopEventTarget,
  rustPath: "crate::api::core::Node",
  size: 80,
  internalFields: {
    first: node.nullable,
    next: node.nullable,
    parent: node.nullable,
    last: node.nullable,
    previous: node.nullable,
    document: node,
    rare: b.any,
  },
  constants: {
    ELEMENT_NODE: 1,
    ATTRIBUTE_NODE: 2,
    TEXT_NODE: 3,
    CDATA_SECTION_NODE: 4,
    ENTITY_REFERENCE_NODE: 5,
    ENTITY_NODE: 6,
    PROCESSING_INSTRUCTION_NODE: 7,
    COMMENT_NODE: 8,
    DOCUMENT_NODE: 9,
    DOCUMENT_TYPE_NODE: 10,
    DOCUMENT_FRAGMENT_NODE: 11,
    NOTATION_NODE: 12,
    DOCUMENT_POSITION_DISCONNECTED: 1,
    DOCUMENT_POSITION_PRECEDING: 2,
    DOCUMENT_POSITION_FOLLOWING: 4,
    DOCUMENT_POSITION_CONTAINS: 8,
    DOCUMENT_POSITION_CONTAINED_BY: 16,
    DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC: 32,
  },
  proto: {
    nodeType: { getter: b.u8, member: "head.node_type" },
    nodeName: { getter: string, onlyReads, shortcut: "nodeName", ...heap },
    baseURI: { getter: string, rustName: "base_uri", ...heap },
    isConnected: { getter: b.bool, pure: true, onlyReads, shortcut: "isConnected" },
    ownerDocument: { getter: b.ref("Doc").nullable, onlyReads, shortcut: "ownerDocument" },
    parentNode: { getter: node.nullable, field: "parent" },
    parentElement: { getter: element.nullable, onlyReads, shortcut: "parentElement" },
    childNodes: { getter: b.any, shortcut: "childNodesEdge", ...heap },
    firstChild: { getter: node.nullable, field: "first", computedIfEmpty: true, onlyReads },
    lastChild: { getter: node.nullable, field: "last", computedIfEmpty: true, onlyReads },
    previousSibling: { getter: node.nullable, field: "previous" },
    nextSibling: { getter: node.nullable, field: "next" },
    nodeValue: { getter: string.nullable, setter: js, ceReactions: true, onlyReads, ...heap },
    textContent: { getter: string.nullable, setter: js, ceReactions: true, onlyReads, ...heap },
    getRootNode: { args: { options: GetRootNodeOptions.default({}) }, returns: node },
    hasChildNodes: { returns: b.bool, onlyReads },
    normalize: { rustName: "js_normalize", ...ce },
    "@@inspectCustom": { returns: b.any, otherReceivers: "Bun::jsDesktopInspectOther", rustName: "inspect", ...js },
    cloneNode: { args: { subtree: b.bool.loose.default(false) }, returns: node, ...ce },
    isEqualNode: { args: { other: node.nullable }, returns: b.bool, rustName: "js_is_equal_node", ...runs },
    isSameNode: { args: { other: node.nullable }, returns: b.bool },
    compareDocumentPosition: { args: { other: node }, returns: b.i32 },
    contains: { args: { other: node.nullable }, returns: b.bool, rustName: "js_contains", withoutFrame },
    lookupPrefix: { args: { namespace: string.nullable }, returns: string.nullable, ...allocates },
    lookupNamespaceURI: {
      args: { prefix: string.nullable },
      returns: string.nullable,
      rustName: "lookup_namespace_uri",
      ...allocates,
    },
    isDefaultNamespace: { args: { namespace: string.nullable }, returns: b.bool, ...allocates },
    insertBefore: { args: { node, child: node.nullable }, returns: node, withoutFrame, ...ce },
    appendChild: { args: { node }, returns: node, withoutFrame, ...ce },
    replaceChild: { args: { node, child: node }, returns: node, withoutFrame, ...ce },
    removeChild: { args: { child: node }, returns: node, withoutFrame, ...ce },
  },
});

export const ParentNode = b.mixin("ParentNode", {
  on: Node,
  proto: {
    children: { getter: b.any, shortcut: "childrenEdge", ...heap },
    firstElementChild: { getter: element.nullable, onlyReads, shortcut: "firstElementChild" },
    lastElementChild: { getter: element.nullable, onlyReads, shortcut: "lastElementChild" },
    childElementCount: { getter: b.u32, ...heap },
    prepend: { args: nodes, unscopable: true, ...ce },
    append: { args: nodes, unscopable: true, ...ce },
    replaceChildren: { args: nodes, unscopable: true, ...ce },
    moveBefore: { args: { node, child: node.nullable }, ...ce },
    querySelector: {
      args: { selectors: string },
      returns: element.nullable,
      rustName: "js_query_selector",
      withoutFrame,
      ...js,
    },
    querySelectorAll: {
      args: { selectors: string },
      returns: b.ref("NodeList"),
      rustName: "js_query_selector_all",
      withoutFrame,
      ...js,
    },
  },
});

export const ElementLookups = b.mixin("ElementLookups", {
  on: Node,
  proto: {
    getElementsByTagName: { args: { qualifiedName: string.atom }, returns: b.any, withoutFrame, ...heap },
    getElementsByTagNameNS: {
      args: { namespace: string.atom.nullable, localName: string.atom },
      returns: b.ref("HTMLCollection"),
      rustName: "get_elements_by_tag_name_ns",
      ...heap,
    },
    getElementsByClassName: { args: { classNames: string.atom }, returns: b.any, withoutFrame, ...heap },
  },
});

export const NonElementParentNode = b.mixin("NonElementParentNode", {
  on: Node,
  proto: { getElementById: { args: { elementId: string }, returns: element.nullable, onlyReads, ...allocates } },
});

export const ChildNode = b.mixin("ChildNode", {
  on: Node,
  proto: {
    before: { args: nodes, unscopable: true, ...ce },
    after: { args: nodes, unscopable: true, ...ce },
    replaceWith: { args: nodes, unscopable: true, ...ce },
    remove: { unscopable: true, withoutFrame, ...ce },
  },
});

export const NonDocumentTypeChildNode = b.mixin("NonDocumentTypeChildNode", {
  on: Node,
  proto: {
    previousElementSibling: { getter: element.nullable, onlyReads, shortcut: "previousElementSibling" },
    nextElementSibling: { getter: element.nullable, onlyReads, shortcut: "nextElementSibling" },
  },
});

export const Slottable = b.mixin("Slottable", { on: Node, proto: { assignedSlot: { getter: element.nullable } } });

export const CharacterData = b.interface("CharacterData", {
  extends: Node,
  includes: [ChildNode, NonDocumentTypeChildNode],
  proto: {
    data: { getter: string.nullToEmpty, setter: js, onlyReads, ...heap },
    length: { getter: b.u32 },
    substringData: { args: { offset, count: offset }, returns: string, ...allocates },
    appendData: { args: { data: string }, rustName: "js_append_data", ...js },
    insertData: { args: { offset, data: string }, ...js },
    deleteData: { args: { offset, count: offset }, ...js },
    replaceData: { args: { offset, count: offset, data: string }, rustName: "js_replace_data", ...js },
  },
});

export const Text = b.interface("Text", {
  extends: CharacterData,
  includes: [Slottable],
  construct: { args: { data: string.optional }, passStructure: true, ...js },
  proto: {
    splitText: { args: { offset }, returns: b.ref("Text"), ...js },
    wholeText: { getter: string, ...heap },
  },
});

export const CDATASection = b.interface("CDATASection", { extends: Text, proto: {} });

export const DomComment = b.interface("DomComment", {
  name: "Comment",
  extends: CharacterData,
  construct: { args: { data: string.optional }, passStructure: true, ...js },
  proto: {},
});

export const ProcessingInstruction = b.interface("ProcessingInstruction", {
  extends: CharacterData,
  proto: {
    target: { getter: string, ...heap },
    hasAttributes: { returns: b.bool },
    getAttributeNames: { returns: b.any.returning("Array"), ...heap },
    getAttribute: { args: { name: string }, returns: string.nullable, ...allocates },
    hasAttribute: { args: { name: string }, returns: b.bool, ...allocates },
    setAttribute: { args: { name: string, value: string }, ...js },
    removeAttribute: { args: { name: string }, ...js },
    toggleAttribute: { args: { name: string, force: b.bool.loose.optional }, returns: b.bool, ...js },
  },
});

export const DocumentType = b.interface("DocumentType", {
  extends: Node,
  includes: [ChildNode],
  proto: {
    name: { getter: string, ...heap },
    publicId: { getter: string, ...heap },
    systemId: { getter: string, ...heap },
  },
});

export const DocumentFragment = b.interface("DocumentFragment", {
  extends: Node,
  includes: [ParentNode, NonElementParentNode],
  construct: { passStructure: true, ...js },
  proto: {},
});

export const ShadowRootMode = b.enumeration({ Open: "open", Closed: "closed" });
export const SlotAssignmentMode = b.enumeration({ Named: "named", Manual: "manual" });
export const ShadowRootInit = b.dictionary(
  {
    clonable: b.bool.loose.default(false),
    customElementRegistry: b.any.omittable,
    delegatesFocus: b.bool.loose.default(false),
    mode: ShadowRootMode,
    referenceTarget: string.nullable.optional,
    serializable: b.bool.loose.default(false),
    slotAssignment: SlotAssignmentMode.default("named"),
  },
  { webidl: true },
);

const customElementRegistry = { getter: b.ref("CustomElementRegistry").nullable } as const;

export const ShadowRoot = b.interface("ShadowRoot", {
  extends: DocumentFragment,
  proto: {
    mode: { getter: string, ...heap },
    host: { getter: element },
    delegatesFocus: { getter: b.bool },
    slotAssignment: { getter: string, ...heap },
    clonable: { getter: b.bool },
    serializable: { getter: b.bool },
    customElementRegistry,
    referenceTarget: { getter: string.nullable, setter: true, rustName: "js_reference_target", ...allocates },
    innerHTML: { getter: string, setter: { type: b.any }, rustName: "inner_html", ...ce },
  },
});

export const Attr = b.interface("Attr", {
  extends: Node,
  proto: {
    namespaceURI: { getter: string.nullable, rustName: "namespace_uri", ...heap },
    prefix: { getter: string.nullable, ...heap },
    localName: { getter: string, ...heap },
    name: { getter: string, ...heap },
    value: { getter: string, setter: true, ...ce },
    ownerElement: { getter: element.nullable },
    specified: { getter: b.bool },
  },
});

export const DomElement = b.interface("DomElement", {
  name: "Element",
  extends: Node,
  includes: [ParentNode, ChildNode, NonDocumentTypeChildNode, Slottable, ElementLookups],
  proto: {
    namespaceURI: { getter: string.nullable, rustName: "namespace_uri", ...heap },
    prefix: { getter: string.nullable, ...heap },
    localName: { getter: string, onlyReads, shortcut: "localName", ...heap },
    tagName: { getter: string, onlyReads, shortcut: "tagName", ...heap },
    id: reflected,
    className: reflected,
    classList: { getter: b.any, putForwards: "value", shortcut: "classListEdge", ...heap },
    part: { getter: b.any, putForwards: "value", ...heap },
    attributes: { getter: b.any, shortcut: "attributesEdge", ...heap },
    slot: { ...reflected, unscopable: true },
    shadowRoot: { getter: b.ref("ShadowRoot").nullable },
    attachShadow: { args: { init: ShadowRootInit }, returns: b.ref("ShadowRoot"), rustName: "js_attach_shadow", ...js },
    customElementRegistry,
    hasAttributes: { returns: b.bool },
    getAttributeNames: { returns: b.any.returning("Array"), ...heap },
    getAttribute: { args: { qualifiedName: string }, returns: string.nullable, onlyReads, ...allocates },
    getAttributeNS: {
      args: { namespace: string.nullable, localName: string },
      returns: string.nullable,
      rustName: "get_attribute_ns",
      ...js,
    },
    setAttribute: { args: { qualifiedName: string, value: b.any }, withoutFrame, ...ce },
    setAttributeNS: {
      args: { namespace: string.nullable, qualifiedName: string, value: b.any },
      rustName: "set_attribute_ns",
      ...ce,
    },
    removeAttribute: { args: { qualifiedName: string }, withoutFrame, ...ce },
    removeAttributeNS: {
      args: { namespace: string.nullable, localName: string },
      rustName: "remove_attribute_ns",
      ...ce,
    },
    toggleAttribute: { args: { qualifiedName: string, force: b.bool.loose.optional }, returns: b.bool, ...ce },
    hasAttribute: { args: { qualifiedName: string }, returns: b.bool, onlyReads, ...allocates },
    hasAttributeNS: {
      args: { namespace: string.nullable, localName: string },
      returns: b.bool,
      rustName: "has_attribute_ns",
      ...allocates,
    },
    getAttributeNode: { args: { qualifiedName: string }, returns: attr.nullable, ...allocates },
    getAttributeNodeNS: {
      args: { namespace: string.nullable, localName: string },
      returns: attr.nullable,
      rustName: "get_attribute_node_ns",
      ...allocates,
    },
    setAttributeNode: { args: { attr }, returns: attr.nullable, ...ce },
    setAttributeNodeNS: { args: { attr }, returns: attr.nullable, rustName: "set_attribute_node", ...ce },
    removeAttributeNode: { args: { attr }, returns: attr, ...ce },
    matches: { args: { selectors: string }, returns: b.bool, rustName: "js_matches", withoutFrame, ...js },
    webkitMatchesSelector: { args: { selectors: string }, returns: b.bool, rustName: "js_matches", ...js },
    closest: { args: { selectors: string }, returns: element.nullable, rustName: "js_closest", withoutFrame, ...js },
    insertAdjacentElement: { args: { position: string, element }, returns: element.nullable, ...ce },
    insertAdjacentText: { args: { position: string, data: string }, ...js },
    insertAdjacentHTML: { args: { position: string, string: b.any }, rustName: "insert_adjacent_html", ...ce },
    innerHTML: { getter: string, setter: { type: b.any }, rustName: "inner_html", ...ce },
    outerHTML: { getter: string, setter: { type: b.any }, rustName: "outer_html", ...ce },
  },
});

export const SetHTMLOptions = b.dictionary({ sanitizer: b.any.omittable }, { webidl: true });

export const Doc = b.interface("Doc", {
  name: "Document",
  extends: Node,
  static: {
    parseHTML: {
      args: { html: string, options: SetHTMLOptions.default({}) },
      returns: b.ref("Doc"),
      rustName: "parse_html",
      ...js,
    },
    parseHTMLUnsafe: {
      args: { html: b.any, options: SetHTMLOptions.default({}) },
      returns: b.ref("Doc"),
      rustName: "parse_html_unsafe",
      ...js,
    },
  },
  includes: [ParentNode, NonElementParentNode, ElementLookups],
  construct: { passNewTarget: true, ...js },
  named: { getter: b.any, overrideBuiltIns: true, announcesNames: true, ...runs },
  proto: {
    doctype: { getter: b.ref("DocumentType").nullable },
    documentElement: { getter: element.nullable, onlyReads, shortcut: "firstElementChild" },
    head: { getter: element.nullable, onlyReads },
    body: {
      getter: element.nullable,
      setter: { type: b.ref("HTMLElement").nullable, ...js },
      ceReactions: true,
      onlyReads,
    },
    all: { getter: b.any, ...heap },
    anchors: { getter: b.any, ...heap },
    applets: { getter: b.any, ...heap },
    embeds: { getter: b.any, ...heap },
    forms: { getter: b.any, ...heap },
    images: { getter: b.any, ...heap },
    links: { getter: b.any, ...heap },
    plugins: { getter: b.any, rustName: "embeds", ...heap },
    scripts: { getter: b.any, ...heap },
    getElementsByName: { args: { elementName: string.atom }, returns: b.any, ...heap },
    createElement: {
      args: { localName: string, options: b.any.omittable },
      returns: element,
      rustName: "js_create_element",
      withoutFrame,
      ...ce,
    },
    createElementNS: {
      args: { namespace: string.nullable, qualifiedName: string, options: b.any.omittable },
      returns: element,
      rustName: "create_element_ns",
      ...ce,
    },
    customElementRegistry,
    createDocumentFragment: { returns: b.ref("DocumentFragment"), withoutFrame, ...heap },
    createTextNode: { args: { data: string }, returns: b.ref("Text"), withoutFrame, ...allocates },
    createComment: { args: { data: string }, returns: node, rustName: "js_create_comment", ...allocates },
    createCDATASection: {
      args: { data: string },
      returns: b.ref("Text"),
      rustName: "create_cdata_section",
      ...allocates,
    },
    createAttribute: { args: { localName: string }, returns: attr, ...allocates },
    createAttributeNS: {
      args: { namespace: string.nullable, qualifiedName: string },
      returns: attr,
      rustName: "create_attribute_ns",
      ...allocates,
    },
  },
});
