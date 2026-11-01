import * as b from "../../codegen/bindgen-lib.ts";

const text = b.bytes({ from: ["string"], otherwise: "toString", refuse: ["undefined", "null"] });

export const ContentOptions = b.dictionary(
  { html: b.bool.loose.default(false) },
  { allowArray: true, nonObjectAsEmpty: true },
);

/** Returns `this`. After the handler returns, `b.this.optional` returns `undefined` and `b.this.nullable` returns `null`. */
const chainable = (returns: b.Type) => ({ returns, passThis: true }) as const;
const contentOp = (returns: b.Type) =>
  ({
    ...chainable(returns),
    args: { content: text, options: ContentOptions.nullable.default({}) },
    expected: { content: "Expected string" },
    capability: "heap",
    throws: true,
  }) as const;

/** `b.any`: an accessor has one type, and the getter gives a string or nothing where the setter takes `ToString` of any value. */
const assignable = (nothing: "null" | "undefined") =>
  ({ getter: b.any.returning("string", nothing), setter: true, capability: "js", throws: true }) as const;

export const TextChunk = b.class({
  rustPath: "crate::api::html_rewriter::TextChunk",
  refCounted: true,
  proto: {
    after: contentOp(b.this.optional),
    before: contentOp(b.this.optional),
    lastInTextNode: { getter: b.bool.optional, cache: true },
    remove: chainable(b.this.optional),
    removed: { getter: b.bool.optional },
    replace: contentOp(b.this.optional),
    text: { getter: b.string.utf8.optional },
  },
});

/** `b.any`: a string, `null` if the doctype has none, `undefined` after the handler returns. */
const doctypeField = {
  getter: b.any.returning("string", "null", "undefined"),
  cache: true,
  capability: "js",
  throws: true,
} as const;

export const DocType = b.class({
  rustPath: "crate::api::html_rewriter::DocType",
  refCounted: true,
  proto: {
    name: doctypeField,
    publicId: doctypeField,
    remove: chainable(b.this.optional),
    removed: { getter: b.bool.optional },
    systemId: doctypeField,
  },
});

export const DocEnd = b.class({
  rustPath: "crate::api::html_rewriter::DocEnd",
  refCounted: true,
  proto: {
    append: contentOp(b.this.nullable),
  },
});

export const Comment = b.class({
  rustPath: "crate::api::html_rewriter::Comment",
  refCounted: true,
  proto: {
    after: contentOp(b.this.nullable),
    before: contentOp(b.this.nullable),
    remove: chainable(b.this.nullable),
    removed: { getter: b.bool.optional },
    replace: contentOp(b.this.nullable),
    text: assignable("null"),
  },
});

export const EndTag = b.class({
  rustPath: "crate::api::html_rewriter::EndTag",
  refCounted: true,
  proto: {
    after: contentOp(b.this.nullable),
    before: contentOp(b.this.nullable),
    name: assignable("undefined"),
    remove: chainable(b.this.optional),
  },
});

/** `value` is `[name, value]`. It is `b.any` for the end, where it is an own `undefined`: an `.optional` member is left out. */
export const AttributeIteratorResult = b.dictionary({ value: b.any, done: b.bool });

export const AttributeIterator = b.class({
  rustPath: "crate::api::html_rewriter::AttributeIterator",
  refCounted: true,
  finalize: true,
  proto: {
    /** Neither keeps the receiver. */
    next: { returns: AttributeIteratorResult, capability: "heap", throws: true, uses: { this: [] } },
    "@@iterator": { ...chainable(b.this), rustName: "get_this" },
  },
});

const named = { args: { name: text }, expected: { name: "Expected string" } } as const;

export const Element = b.class({
  rustPath: "crate::api::html_rewriter::Element",
  refCounted: true,
  proto: {
    after: contentOp(b.this.optional),
    append: contentOp(b.this.optional),
    attributes: { getter: AttributeIterator.optional, capability: "js" },
    before: contentOp(b.this.optional),
    canHaveContent: { getter: b.bool.optional },
    getAttribute: { ...named, returns: b.string.utf8.nullable },
    hasAttribute: { ...named, returns: b.bool, capability: "heap", throws: true },
    namespaceURI: { getter: b.string.utf8.optional, cache: true },
    onEndTag: {
      ...chainable(b.this.nullable),
      /** `b.any`: a detached element returns `null` without checking it. */
      args: { handler: b.any },
      capability: "js",
      throws: true,
    },
    prepend: contentOp(b.this.optional),
    remove: chainable(b.this.optional),
    removeAndKeepContent: chainable(b.this.optional),
    removeAttribute: { ...chainable(b.this.optional), ...named, capability: "heap", throws: true },
    removed: { getter: b.bool.optional },
    replace: contentOp(b.this.optional),
    selfClosing: { getter: b.bool.optional },
    setAttribute: {
      ...chainable(b.this.optional),
      args: { name: text, value: text },
      expected: { name: "Expected string", value: "Expected string" },
      capability: "heap",
      throws: true,
    },
    setInnerContent: contentOp(b.this.optional),
    tagName: assignable("undefined"),
  },
});

export const HTMLRewriter = b.class({
  rustPath: "crate::api::html_rewriter::HTMLRewriter",
  construct: {},
  /** The `on()` / `onDocument()` callbacks: `HandlerList` in html_rewriter.rs. */
  internalFields: ["handlers"],
  proto: {
    on: { ...chainable(b.this), args: { selector: b.any, handlers: b.any }, capability: "js", throws: true },
    onDocument: { ...chainable(b.this), args: { handlers: b.any }, capability: "js", throws: true },
    transform: {
      args: { input: b.any },
      returns: b.any.returning("string", "object"),
      capability: "js",
      throws: true,
      passThis: true,
    },
  },
});

/** One per `transform()`, never exposed to JavaScript: the output `Response` keeps it alive, and its internal fields keep alive the values the rewrite uses. */
export const HTMLRewriterTransform = b.class({
  rustPath: "crate::api::html_rewriter::RewriterPipe",
  refCounted: true,
  finalize: true,
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
