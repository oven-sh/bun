import { define } from "../../codegen/class-definitions.ts";

export default [
  define({
    name: "HTMLRewriter",
    // R-2 Phase 2: user impls take `&self`; emit `this: &T` shims.
    sharedThis: true,
    construct: true,
    finalize: true,
    JSType: "0b11101110",
    configurable: false,
    klass: {},
    // The `on()` / `onDocument()` callbacks: `HandlerList` in html_rewriter.rs.
    values: ["handlers"],
    proto: {
      on: {
        fn: "on",
        returns: "this",
        checkedAtRuntime: true,
        length: 2,
      },
      onDocument: {
        fn: "onDocument",
        returns: "this",
        checkedAtRuntime: true,
        length: 1,
      },
      transform: {
        fn: "transform",
        returns: "string | object",
        checkedAtRuntime: true,
        length: 1,
      },
    },
  }),
  define({
    name: "TextChunk",
    // R-2 Phase 2: user impls take `&self`; emit `this: &T` shims.
    sharedThis: true,
    construct: true,
    refCounted: true,
    JSType: "0b11101110",
    configurable: false,
    noConstructor: true,
    klass: {},
    proto: {
      before: {
        fn: "before",
        returns: "this | undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      after: {
        fn: "after",
        returns: "this | undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      replace: {
        fn: "replace",
        returns: "this | undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      remove: {
        fn: "remove",
        returns: "this | undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      removed: {
        getter: "removed",
        type: "boolean | undefined",
        checkedAtRuntime: true,
      },
      lastInTextNode: {
        getter: "lastInTextNode",
        type: "boolean | undefined",
        checkedAtRuntime: true,
        cache: true,
      },
      text: {
        getter: "getText",
        type: "string | undefined",
        checkedAtRuntime: true,
      },
    },
  }),
  define({
    name: "DocType",
    // R-2 Phase 2: user impls take `&self`; emit `this: &T` shims.
    sharedThis: true,
    construct: true,
    refCounted: true,
    JSType: "0b11101110",
    configurable: false,
    noConstructor: true,
    klass: {},
    proto: {
      name: {
        getter: "name",
        type: "string | null | undefined",
        checkedAtRuntime: true,
        cache: true,
      },
      systemId: {
        getter: "systemId",
        type: "string | null | undefined",
        checkedAtRuntime: true,
        cache: true,
      },
      publicId: {
        getter: "publicId",
        type: "string | null | undefined",
        checkedAtRuntime: true,
        cache: true,
      },
      remove: {
        fn: "remove",
        returns: "this | undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      removed: {
        getter: "removed",
        type: "boolean | undefined",
        checkedAtRuntime: true,
      },
    },
  }),
  define({
    name: "DocEnd",
    // R-2 Phase 2: user impls take `&self`; emit `this: &T` shims.
    sharedThis: true,
    construct: true,
    refCounted: true,
    JSType: "0b11101110",
    configurable: false,
    noConstructor: true,
    klass: {},
    proto: {
      append: {
        fn: "append",
        returns: "this | null",
        checkedAtRuntime: true,
        length: 1,
      },
    },
  }),
  define({
    name: "Comment",
    // R-2 Phase 2: user impls take `&self`; emit `this: &T` shims.
    sharedThis: true,
    construct: true,
    refCounted: true,
    JSType: "0b11101110",
    configurable: false,
    noConstructor: true,
    klass: {},
    proto: {
      before: {
        fn: "before",
        returns: "this | null",
        checkedAtRuntime: true,
        length: 1,
      },
      after: {
        fn: "after",
        returns: "this | null",
        checkedAtRuntime: true,
        length: 1,
      },
      replace: {
        fn: "replace",
        returns: "this | null",
        checkedAtRuntime: true,
        length: 1,
      },
      remove: {
        fn: "remove",
        returns: "this | null",
        checkedAtRuntime: true,
        length: 0,
      },
      removed: {
        getter: "removed",
        type: "boolean | undefined",
        checkedAtRuntime: true,
      },
      text: {
        getter: "getText",
        type: "string | null",
        checkedAtRuntime: true,
        setter: "setText",
      },
    },
  }),
  define({
    name: "EndTag",
    // R-2 Phase 2: user impls take `&self`; emit `this: &T` shims.
    sharedThis: true,
    construct: true,
    refCounted: true,
    JSType: "0b11101110",
    configurable: false,
    noConstructor: true,
    klass: {},
    proto: {
      before: {
        fn: "before",
        returns: "this | null",
        checkedAtRuntime: true,
        length: 1,
      },
      after: {
        fn: "after",
        returns: "this | null",
        checkedAtRuntime: true,
        length: 1,
      },
      remove: {
        fn: "remove",
        returns: "this | undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      name: {
        getter: "getName",
        type: "string | undefined",
        checkedAtRuntime: true,
        setter: "setName",
      },
    },
  }),
  define({
    name: "AttributeIterator",
    // R-2 Phase 2: user impls take `&self`; emit `this: &T` shims.
    sharedThis: true,
    construct: true,
    refCounted: true,
    JSType: "0b11101110",
    configurable: false,
    noConstructor: true,
    klass: {},
    proto: {
      // html_rewriter.rs AttributeIterator::next, get_this: neither keeps the receiver.
      next: {
        fn: "next",
        returns: "object",
        checkedAtRuntime: true,
        length: 0,
        uses: { this: [] },
      },
      "@@iterator": {
        fn: "getThis",
        returns: "this",
        checkedAtRuntime: true,
        length: 0,
        uses: { this: [] },
      },
    },
  }),
  define({
    name: "Element",
    // R-2 Phase 2: user impls take `&self`; emit `this: &T` shims.
    sharedThis: true,
    construct: true,
    refCounted: true,
    JSType: "0b11101110",
    configurable: false,
    noConstructor: true,
    klass: {},
    proto: {
      getAttribute: {
        fn: "getAttribute",
        returns: "string | null",
        checkedAtRuntime: true,
        length: 1,
      },

      hasAttribute: {
        fn: "hasAttribute",
        returns: "boolean",
        checkedAtRuntime: true,
        length: 1,
      },

      setAttribute: {
        fn: "setAttribute",
        returns: "this | undefined",
        checkedAtRuntime: true,
        length: 2,
      },
      removeAttribute: {
        fn: "removeAttribute",
        returns: "this | undefined",
        checkedAtRuntime: true,
        length: 1,
      },

      before: {
        fn: "before",
        returns: "this | undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      after: {
        fn: "after",
        returns: "this | undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      replace: {
        fn: "replace",
        returns: "this | undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      prepend: {
        fn: "prepend",
        returns: "this | undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      append: {
        fn: "append",
        returns: "this | undefined",
        checkedAtRuntime: true,
        length: 1,
      },
      setInnerContent: {
        fn: "setInnerContent",
        returns: "this | undefined",
        checkedAtRuntime: true,
        length: 1,
      },

      remove: {
        fn: "remove",
        returns: "this | undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      removeAndKeepContent: {
        fn: "removeAndKeepContent",
        returns: "this | undefined",
        checkedAtRuntime: true,
        length: 0,
      },
      onEndTag: {
        fn: "onEndTag",
        returns: "this | null",
        checkedAtRuntime: true,
        length: 1,
      },

      tagName: {
        getter: "getTagName",
        type: "string | undefined",
        checkedAtRuntime: true,
        setter: "setTagName",
      },
      removed: {
        getter: "getRemoved",
        type: "boolean | undefined",
        checkedAtRuntime: true,
      },
      selfClosing: {
        getter: "getSelfClosing",
        type: "boolean | undefined",
        checkedAtRuntime: true,
      },
      canHaveContent: {
        getter: "getCanHaveContent",
        type: "boolean | undefined",
        checkedAtRuntime: true,
      },
      namespaceURI: {
        getter: "getNamespaceURI",
        type: "string | undefined",
        checkedAtRuntime: true,
        cache: true,
      },
      attributes: {
        getter: "getAttributes",
        type: "AttributeIterator | undefined",
        checkedAtRuntime: true,
      },
    },
  }),
  // Not user-visible. One per `transform()` call; the output Response roots it
  // via its `values: [..., "transform"]` slot, and it is the `.then()` context
  // for a suspended handler's promise. Its finalizer owns the native
  // `RewriterPipe` box and the boxed lol-html rewriter.
  define({
    name: "HTMLRewriterTransform",
    construct: false,
    noConstructor: true,
    refCounted: true,
    klass: {},
    proto: {},
    // WriteBarrier slots: everything the pipe must keep reachable and that
    // would otherwise need a StrongOptional root.
    values: [
      "response",
      "inputStream",
      "outputStream",
      "pendingPromise",
      "handlerError",
      "suspensionPromise",
      "handlers",
      // The array of `element.onEndTag()` callbacks that have not run yet.
      "endTagHandlers",
    ],
  }),
];
