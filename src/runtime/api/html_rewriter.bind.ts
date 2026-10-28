import * as b from "../../codegen/bindgen-lib.ts";
import { Response } from "../webcore/response.bind.ts";

const text = b.bytes({ from: ["string"], otherwise: "toString", refuse: ["undefined", "null"] });

export const ContentOptions = b.dictionary(
  { html: b.bool.loose.default(false) },
  { allowArray: true, nonObjectAsEmpty: true },
);

/** Returns `this`. After the handler returns, `b.self.optional` returns `undefined` and `b.self.nullable` returns `null`. */
const chainable = (returns: b.Type) => ({ returns, passThis: true }) as const;
const contentOp = (returns: b.Type) =>
  ({
    ...chainable(returns),
    args: { content: text, options: ContentOptions.nullable.default({}) },
    expected: { content: "Expected string" },
    capability: "heap",
    throws: true,
  }) as const;

/** After the handler returns, the setter returns before `ToString`. */
const assignable = (getter: b.Type) =>
  ({ getter, setter: { type: b.opaque, capability: "js" }, throws: true }) as const;

export const TextChunk = b.class({
  rustPath: "crate::api::html_rewriter::TextChunk",
  refCounted: true,
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

/** A string, `null` if the doctype has none, `undefined` after the handler returns. */
const doctypeField = {
  getter: b.opaque.returning("string", "null", "undefined"),
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
    remove: chainable(b.self.optional),
    removed: { getter: b.bool.optional },
    systemId: doctypeField,
  },
});

export const DocEnd = b.class({
  rustPath: "crate::api::html_rewriter::DocEnd",
  refCounted: true,
  proto: {
    append: contentOp(b.self.nullable),
  },
});

export const Comment = b.class({
  rustPath: "crate::api::html_rewriter::Comment",
  refCounted: true,
  proto: {
    after: contentOp(b.self.nullable),
    before: contentOp(b.self.nullable),
    remove: chainable(b.self.nullable),
    removed: { getter: b.bool.optional },
    replace: contentOp(b.self.nullable),
    text: assignable(b.string.utf8.nullable),
  },
});

export const EndTag = b.class({
  rustPath: "crate::api::html_rewriter::EndTag",
  refCounted: true,
  proto: {
    after: contentOp(b.self.nullable),
    before: contentOp(b.self.nullable),
    name: assignable(b.string.utf8.optional),
    remove: chainable(b.self.optional),
  },
});

/** `value` is `[name, value]`. At the end it is an own `undefined`: an `.optional` member is left out. */
export const AttributeIteratorResult = b.dictionary({ value: b.opaque, done: b.bool });

export const AttributeIterator = b.class({
  rustPath: "crate::api::html_rewriter::AttributeIterator",
  refCounted: true,
  finalize: true,
  proto: {
    /** Neither keeps the receiver. */
    next: { returns: AttributeIteratorResult, capability: "heap", throws: true, uses: { this: [] } },
    "@@iterator": { ...chainable(b.self), rustName: "get_this", uses: { this: [{ use: "Returns" }] } },
  },
});

const named = { args: { name: text }, expected: { name: "Expected string" } } as const;

export const Element = b.class({
  rustPath: "crate::api::html_rewriter::Element",
  refCounted: true,
  proto: {
    after: contentOp(b.self.optional),
    append: contentOp(b.self.optional),
    attributes: { getter: AttributeIterator.optional, capability: "js" },
    before: contentOp(b.self.optional),
    canHaveContent: { getter: b.bool.optional },
    getAttribute: { ...named, returns: b.string.utf8.nullable },
    hasAttribute: { ...named, returns: b.bool, capability: "heap", throws: true },
    namespaceURI: { getter: b.string.utf8.optional, cache: true },
    onEndTag: {
      ...chainable(b.self.nullable),
      /** A detached element returns `null` without checking it. */
      args: { handler: b.callable.otherAsNull },
      capability: "js",
      throws: true,
      length: 1,
    },
    prepend: contentOp(b.self.optional),
    remove: chainable(b.self.optional),
    removeAndKeepContent: chainable(b.self.optional),
    removeAttribute: { ...chainable(b.self.optional), ...named, capability: "heap", throws: true },
    removed: { getter: b.bool.optional },
    replace: contentOp(b.self.optional),
    selfClosing: { getter: b.bool.optional },
    setAttribute: {
      ...chainable(b.self.optional),
      args: { name: text, value: text },
      expected: { name: "Expected string", value: "Expected string" },
      capability: "heap",
      throws: true,
    },
    setInnerContent: contentOp(b.self.optional),
    tagName: assignable(b.string.utf8.optional),
  },
});

export const DocumentHandlers = b.dictionary(
  {
    doctype: b.callable.optional,
    comments: b.callable.optional,
    text: b.callable.optional,
    end: b.callable.optional,
  },
  { allowArray: true, reportedAs: "" },
);

export const ElementHandlers = b.dictionary(
  {
    element: b.callable.optional,
    comments: b.callable.optional,
    text: b.callable.optional,
  },
  { deferred: true, reportedAs: "" },
);

export const RewriterInput = b.union({
  response: Response,
  string: b.stringLike,
  dataView: b.dataView,
  buffer: b.bufferSource.allowShared,
  other: b.ignored,
});

export const HTMLRewriter = b.class({
  rustPath: "crate::api::html_rewriter::HTMLRewriter",
  construct: {},
  /** The `on()` / `onDocument()` callbacks: `HandlerList` in html_rewriter.rs. */
  internalFields: ["handlers"],
  proto: {
    /** The handlers are read once the selector has parsed. */
    on: {
      ...chainable(b.self),
      args: { selector: b.string.loose.utf8.owned.nullable, handlers: ElementHandlers.otherAsNull },
      capability: "js",
      throws: true,
      length: 2,
    },
    onDocument: {
      ...chainable(b.self),
      args: { handlers: DocumentHandlers.withValue },
      expected: { handlers: "Expected object" },
      capability: "js",
      throws: true,
    },
    /** Returns what it was given: a `Response`, a string or an `ArrayBuffer`. */
    transform: {
      args: { input: RewriterInput },
      returns: b.opaque.returning("string", "object"),
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
