import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "HTMLRewriter",
    construct: true,
    finalize: true,
    JSType: "0b11101110",
    configurable: false,
    klass: {},
    proto: {
      on: {
        fn: "on",
        length: 2,
      },
      onDocument: {
        fn: "onDocument",
        length: 1,
      },
      transform: {
        fn: "transform",
        length: 1,
      },
    },
  }),
  define({
    name: "TextChunk",
    construct: true,
    finalize: true,
    JSType: "0b11101110",
    configurable: false,
    noConstructor: true,
    klass: {},
    proto: {
      before: {
        fn: "before",
        length: 1,
      },
      after: {
        fn: "after",
        length: 1,
      },
      replace: {
        fn: "replace",
        length: 1,
      },
      remove: {
        fn: "remove",
        length: 0,
      },
      removed: {
        getter: "removed",
      },
      lastInTextNode: {
        getter: "lastInTextNode",
        cache: true,
      },
      text: {
        getter: "getText",
      },
    },
  }),
  define({
    name: "DocType",
    construct: true,
    finalize: true,
    JSType: "0b11101110",
    configurable: false,
    noConstructor: true,
    klass: {},
    proto: {
      name: {
        getter: "name",
        cache: true,
      },
      systemId: {
        getter: "systemId",
        cache: true,
      },
      publicId: {
        getter: "publicId",
        cache: true,
      },
      remove: {
        fn: "remove",
        length: 0,
      },
      removed: {
        getter: "removed",
      },
    },
  }),
  define({
    name: "DocEnd",
    construct: true,
    finalize: true,
    JSType: "0b11101110",
    configurable: false,
    noConstructor: true,
    klass: {},
    proto: {
      append: {
        fn: "append",
        length: 1,
      },
    },
  }),
  define({
    name: "Comment",
    construct: true,
    finalize: true,
    JSType: "0b11101110",
    configurable: false,
    noConstructor: true,
    klass: {},
    proto: {
      before: {
        fn: "before",
        length: 1,
      },
      after: {
        fn: "after",
        length: 1,
      },
      replace: {
        fn: "replace",
        length: 1,
      },
      remove: {
        fn: "remove",
        length: 0,
      },
      removed: {
        getter: "removed",
      },
      text: {
        getter: "getText",
        setter: "setText",
      },
    },
  }),
  define({
    name: "EndTag",
    construct: true,
    finalize: true,
    JSType: "0b11101110",
    configurable: false,
    noConstructor: true,
    klass: {},
    proto: {
      before: {
        fn: "before",
        length: 1,
      },
      after: {
        fn: "after",
        length: 1,
      },
      remove: {
        fn: "remove",
        length: 0,
      },
      name: {
        getter: "getName",
        setter: "setName",
      },
    },
  }),
  define({
    name: "AttributeIterator",
    construct: true,
    finalize: true,
    JSType: "0b11101110",
    configurable: false,
    noConstructor: true,
    klass: {},
    proto: {
      next: {
        fn: "next",
        length: 0,
      },
      "@@iterator": {
        fn: "getThis",
        length: 0,
      },
    },
  }),
  define({
    name: "Element",
    construct: true,
    finalize: true,
    JSType: "0b11101110",
    configurable: false,
    noConstructor: true,
    klass: {},
    proto: {
      getAttribute: {
        fn: "getAttribute",
        length: 1,
      },

      hasAttribute: {
        fn: "hasAttribute",
        length: 1,
      },

      setAttribute: {
        fn: "setAttribute",
        length: 2,
      },
      removeAttribute: {
        fn: "removeAttribute",
        length: 1,
      },

      before: {
        fn: "before",
        length: 1,
      },
      after: {
        fn: "after",
        length: 1,
      },
      replace: {
        fn: "replace",
        length: 1,
      },
      prepend: {
        fn: "prepend",
        length: 1,
      },
      append: {
        fn: "append",
        length: 1,
      },
      setInnerContent: {
        fn: "setInnerContent",
        length: 1,
      },

      remove: {
        fn: "remove",
        length: 0,
      },
      removeAndKeepContent: {
        fn: "removeAndKeepContent",
        length: 0,
      },
      onEndTag: {
        fn: "onEndTag",
        length: 1,
      },

      tagName: {
        getter: "getTagName",
        setter: "setTagName",
      },
      removed: {
        getter: "getRemoved",
      },
      selfClosing: {
        getter: "getSelfClosing",
      },
      canHaveContent: {
        getter: "getCanHaveContent",
      },
      namespaceURI: {
        getter: "getNamespaceURI",
        cache: true,
      },
      attributes: {
        getter: "getAttributes",
      },
    },
  }),
];
