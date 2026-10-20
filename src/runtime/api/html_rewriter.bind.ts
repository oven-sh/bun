import * as b from "../../codegen/bindgen-lib.ts";

const string = b.bytes({ from: ["string"], otherwise: "toString", refuse: ["undefined", "null"] });

export const ContentOptions = b.dictionary(
  { html: b.bool.loose.default(false) },
  { allowArray: true, nonObjectAsEmpty: true },
);

/** `detached` is the object, or what its class gives once the handler has returned: `undefined` or `null`. */
const chained = (detached: b.Type) => ({ returns: detached, passThis: true, capability: "heap" }) as const;
const inserts = (detached: b.Type) =>
  ({
    ...chained(detached),
    args: { content: string, options: ContentOptions.nullable.default({}) },
    expected: { content: "Expected string" },
    throws: true,
  }) as const;

/** What is assigned is not converted once the handler has returned. */
const assignable = { getter: b.any, setter: true, capability: "js", throws: true } as const;

export const TextChunk = b.class({
  rustPath: "crate::api::html_rewriter::TextChunk",
  refCounted: true,
  configurable: false,
  proto: {
    after: inserts(b.self.optional),
    before: inserts(b.self.optional),
    lastInTextNode: { getter: b.bool.optional, cache: true },
    remove: chained(b.self.optional),
    removed: { getter: b.bool.optional },
    replace: inserts(b.self.optional),
    text: { getter: b.string.utf8.optional, rustName: "get_text" },
  },
});

/** `null` where the doctype has none, `undefined` once the handler has returned. */
const identifier = { getter: b.any, cache: true, capability: "heap", throws: true } as const;

export const DocType = b.class({
  rustPath: "crate::api::html_rewriter::DocType",
  refCounted: true,
  configurable: false,
  proto: {
    name: identifier,
    publicId: identifier,
    remove: chained(b.self.optional),
    removed: { getter: b.bool.optional },
    systemId: identifier,
  },
});

export const DocEnd = b.class({
  rustPath: "crate::api::html_rewriter::DocEnd",
  refCounted: true,
  configurable: false,
  proto: {
    append: inserts(b.self.nullable),
  },
});

export const Comment = b.class({
  rustPath: "crate::api::html_rewriter::Comment",
  refCounted: true,
  configurable: false,
  proto: {
    after: inserts(b.self.nullable),
    before: inserts(b.self.nullable),
    remove: chained(b.self.nullable),
    removed: { getter: b.bool.optional },
    replace: inserts(b.self.nullable),
    text: assignable,
  },
});

export const EndTag = b.class({
  rustPath: "crate::api::html_rewriter::EndTag",
  refCounted: true,
  configurable: false,
  proto: {
    after: inserts(b.self.nullable),
    before: inserts(b.self.nullable),
    name: assignable,
    remove: chained(b.self.optional),
  },
});

/** `value` is there when `done` too. */
export const AttributeIteratorResult = b.dictionary({ value: b.any, done: b.bool });

export const AttributeIterator = b.class({
  rustPath: "crate::api::html_rewriter::AttributeIterator",
  refCounted: true,
  finalize: true,
  configurable: false,
  proto: {
    next: { returns: AttributeIteratorResult, capability: "heap", throws: true },
    "@@iterator": { ...chained(b.self), rustName: "get_this" },
  },
});

const named = { args: { name: string }, expected: { name: "Expected string" } } as const;

export const Element = b.class({
  rustPath: "crate::api::html_rewriter::Element",
  refCounted: true,
  configurable: false,
  proto: {
    after: inserts(b.self.optional),
    append: inserts(b.self.optional),
    attributes: { getter: AttributeIterator.optional, capability: "heap", rustName: "get_attributes" },
    before: inserts(b.self.optional),
    canHaveContent: { getter: b.bool.optional, rustName: "get_can_have_content" },
    getAttribute: { ...named, returns: b.string.utf8.nullable },
    hasAttribute: { ...named, returns: b.bool, capability: "heap", throws: true },
    namespaceURI: { getter: b.string.utf8.optional, cache: true, rustName: "get_namespace_uri" },
    /** Whether `handler` is a function is not looked at once the handler of the element has returned. */
    onEndTag: { ...chained(b.self.nullable), args: { handler: b.any }, throws: true },
    prepend: inserts(b.self.optional),
    remove: chained(b.self.optional),
    removeAndKeepContent: chained(b.self.optional),
    removeAttribute: { ...chained(b.self.optional), ...named, throws: true },
    removed: { getter: b.bool.optional, rustName: "get_removed" },
    replace: inserts(b.self.optional),
    selfClosing: { getter: b.bool.optional, rustName: "get_self_closing" },
    setAttribute: {
      ...chained(b.self.optional),
      args: { name: string, value: string },
      expected: { name: "Expected string", value: "Expected string" },
      throws: true,
    },
    setInnerContent: inserts(b.self.optional),
    tagName: assignable,
  },
});

/** One per `transform()`. JavaScript never sees it: the output `Response` holds it, and it holds what the rewrite needs. */
export const HTMLRewriterTransform = b.class({
  rustPath: "crate::api::html_rewriter::RewriterPipe",
  refCounted: true,
  finalize: true,
  fromJS: true,
  internalFields: [
    "response",
    "inputStream",
    "outputStream",
    "pendingPromise",
    "handlerError",
    "suspensionPromise",
    "handlers",
    /** The array of `element.onEndTag()` callbacks that have not run yet. */
    "endTagHandlers",
  ],
});
