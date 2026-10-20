import * as b from "../../codegen/bindgen-lib.ts";

const string = b.bytes({ from: ["string"], otherwise: "toString", refuse: ["undefined", "null"] });

export const ContentOptions = b.dictionary(
  { html: b.bool.loose.default(false) },
  { allowArray: true, nonObjectAsEmpty: true },
);

/** `returns` is `b.self.optional` or `b.self.nullable`: after the handler returns, the method returns `undefined` or `null` (it varies by class) instead of `this`. */
const chainable = (returns: b.Type) => ({ returns, passThis: true, capability: "heap" }) as const;
const contentOp = (returns: b.Type) =>
  ({
    ...chainable(returns),
    args: { content: string, options: ContentOptions.nullable.default({}) },
    expected: { content: "Expected string" },
    throws: true,
  }) as const;

/** `b.any`, not a string: after the handler returns, the setter ignores the value without converting it. */
const assignable = { getter: b.any, setter: true, capability: "js", throws: true } as const;

export const TextChunk = b.class({
  rustPath: "crate::api::html_rewriter::TextChunk",
  refCounted: true,
  configurable: false,
  proto: {
    after: contentOp(b.self.optional),
    before: contentOp(b.self.optional),
    lastInTextNode: { getter: b.bool.optional, cache: true },
    remove: chainable(b.self.optional),
    removed: { getter: b.bool.optional },
    replace: contentOp(b.self.optional),
    text: { getter: b.string.utf8.optional },
  },
});

/** `null` if the doctype has none, `undefined` after the handler returns. */
const identifier = { getter: b.any, cache: true, capability: "heap", throws: true } as const;

export const DocType = b.class({
  rustPath: "crate::api::html_rewriter::DocType",
  refCounted: true,
  configurable: false,
  proto: {
    name: identifier,
    publicId: identifier,
    remove: chainable(b.self.optional),
    removed: { getter: b.bool.optional },
    systemId: identifier,
  },
});

export const DocEnd = b.class({
  rustPath: "crate::api::html_rewriter::DocEnd",
  refCounted: true,
  configurable: false,
  proto: {
    append: contentOp(b.self.nullable),
  },
});

export const Comment = b.class({
  rustPath: "crate::api::html_rewriter::Comment",
  refCounted: true,
  configurable: false,
  proto: {
    after: contentOp(b.self.nullable),
    before: contentOp(b.self.nullable),
    remove: chainable(b.self.nullable),
    removed: { getter: b.bool.optional },
    replace: contentOp(b.self.nullable),
    text: assignable,
  },
});

export const EndTag = b.class({
  rustPath: "crate::api::html_rewriter::EndTag",
  refCounted: true,
  configurable: false,
  proto: {
    after: contentOp(b.self.nullable),
    before: contentOp(b.self.nullable),
    name: assignable,
    remove: chainable(b.self.optional),
  },
});

/** `value` is an own property even when `done` is true. */
export const AttributeIteratorResult = b.dictionary({ value: b.any, done: b.bool });

export const AttributeIterator = b.class({
  rustPath: "crate::api::html_rewriter::AttributeIterator",
  refCounted: true,
  finalize: true,
  configurable: false,
  proto: {
    next: { returns: AttributeIteratorResult, capability: "heap", throws: true },
    "@@iterator": { ...chainable(b.self), rustName: "get_this" },
  },
});

const named = { args: { name: string }, expected: { name: "Expected string" } } as const;

export const Element = b.class({
  rustPath: "crate::api::html_rewriter::Element",
  refCounted: true,
  configurable: false,
  proto: {
    after: contentOp(b.self.optional),
    append: contentOp(b.self.optional),
    attributes: { getter: AttributeIterator.optional, capability: "heap" },
    before: contentOp(b.self.optional),
    canHaveContent: { getter: b.bool.optional },
    getAttribute: { ...named, returns: b.string.utf8.nullable },
    hasAttribute: { ...named, returns: b.bool, capability: "heap", throws: true },
    namespaceURI: { getter: b.string.utf8.optional, cache: true },
    /** `b.any`: after the element handler returns, `handler` is not type-checked. */
    onEndTag: { ...chainable(b.self.nullable), args: { handler: b.any }, throws: true },
    prepend: contentOp(b.self.optional),
    remove: chainable(b.self.optional),
    removeAndKeepContent: chainable(b.self.optional),
    removeAttribute: { ...chainable(b.self.optional), ...named, throws: true },
    removed: { getter: b.bool.optional },
    replace: contentOp(b.self.optional),
    selfClosing: { getter: b.bool.optional },
    setAttribute: {
      ...chainable(b.self.optional),
      args: { name: string, value: string },
      expected: { name: "Expected string", value: "Expected string" },
      throws: true,
    },
    setInnerContent: contentOp(b.self.optional),
    tagName: assignable,
  },
});

/** One per `transform()`, never exposed to JavaScript: the output `Response` keeps it alive, and its internal fields keep alive the values the rewrite uses. */
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
