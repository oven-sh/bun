import { define } from "../../codegen/class-definitions.ts";

export default [
  define({
    name: "Request",
    // R-2 Phase 2: user impls take `&self`; emit `this: &T` shims.
    sharedThis: true,
    construct: true,
    constructNeedsThis: true,
    finalize: true,
    final: false,
    klass: {},
    JSType: "0b11101110",
    estimatedSize: true,
    configurable: false,
    lockedPrototype: true,
    types: [{ path: ["Request"], isView: true, typeArguments: [] }],
    overridesToJS: true,
    memoryCost: true,
    values: ["stream"],
    proto: {
      text: { fn: "getText", returns: "Promise", checkedAtRuntime: true, async: true },
      textStream: { fn: "getTextStream", returns: "ReadableStream", checkedAtRuntime: true },
      json: {
        fn: "getJSON",
        returns: "Promise",
        checkedAtRuntime: true,
        async: true,
        typedResultForm: { form: "ParsedBody", source: "this" },
      },
      bytes: { fn: "getBytes", returns: "Promise", checkedAtRuntime: true, async: true },
      body: { getter: "getBody", cache: true, type: "ReadableStream | null" },
      arrayBuffer: { fn: "getArrayBuffer", returns: "Promise", checkedAtRuntime: true, async: true },
      formData: { fn: "getFormData", returns: "Promise", checkedAtRuntime: true, async: true },
      blob: { fn: "getBlob", returns: "Promise", checkedAtRuntime: true, async: true },
      clone: { fn: "doClone", returns: "Request", checkedAtRuntime: true, length: 1 },
      cache: {
        getter: "getCache",
        type: "string",
      },
      credentials: {
        getter: "getCredentials",
        type: "string",
      },
      destination: {
        getter: "getDestination",
        type: "string",
      },
      headers: {
        getter: "getHeaders",
        cache: true,
        type: "Headers",
      },
      integrity: {
        getter: "getIntegrity",
        type: "string",
      },
      method: {
        getter: "getMethod",
        type: "string",
      },
      mode: {
        getter: "getMode",
        type: "string",
      },
      redirect: {
        getter: "getRedirect",
        type: "string",
      },
      referrer: {
        getter: "getReferrer",
        type: "string",
      },
      referrerPolicy: {
        getter: "getReferrerPolicy",
        type: "string",
      },
      url: {
        getter: "getUrl",
        cache: true,
        type: "string",
      },
      bodyUsed: {
        getter: "getBodyUsed",
        type: "boolean",
      },
      signal: {
        getter: "getSignal",
        cache: true,
        type: "AbortSignal",
      },
    },
  }),
  define({
    name: "Response",
    // R-2 Phase 2: user impls take `&self`; emit `this: &T` shims.
    sharedThis: true,
    construct: true,
    constructNeedsThis: true,
    refCounted: true,
    final: false,
    JSType: "0b11101110",
    configurable: false,
    lockedPrototype: true,
    types: [{ path: ["Response"], isView: true, typeArguments: [] }],
    estimatedSize: true,
    overridesToJS: true,
    klass: {
      json: {
        fn: "constructJSON",
        returns: "Response",
        checkedAtRuntime: true,
        jsonTextForm: { argument: 0, nativeSymbol: "Response__constructJSONFromText" },
      },
      redirect: {
        fn: "constructRedirect",
        returns: "Response",
        checkedAtRuntime: true,
      },
      error: {
        fn: "constructError",
        returns: "Response",
        checkedAtRuntime: true,
      },
    },
    values: ["stream", "transform"],
    proto: {
      url: {
        getter: "getURL",
        cache: true,
        type: "string",
      },
      body: { getter: "getBody", cache: true, type: "ReadableStream | null" },

      text: { fn: "getText", returns: "Promise", checkedAtRuntime: true, async: true },
      textStream: { fn: "getTextStream", returns: "ReadableStream", checkedAtRuntime: true },
      json: {
        fn: "getJSON",
        returns: "Promise",
        checkedAtRuntime: true,
        async: true,
        typedResultForm: { form: "ParsedBody", source: "this" },
      },
      bytes: { fn: "getBytes", returns: "Promise", checkedAtRuntime: true, async: true },
      arrayBuffer: { fn: "getArrayBuffer", returns: "Promise", checkedAtRuntime: true, async: true },
      blob: { fn: "getBlob", returns: "Promise", checkedAtRuntime: true, async: true },
      formData: { fn: "getFormData", returns: "Promise", checkedAtRuntime: true, async: true },

      clone: { fn: "doClone", returns: "Response", checkedAtRuntime: true, length: 1 },

      type: {
        getter: "getResponseType",
        type: "string",
      },
      headers: {
        getter: "getHeaders",
        cache: true,
        type: "Headers",
      },
      redirected: {
        getter: "getRedirected",
        type: "boolean",
      },
      statusText: {
        getter: "getStatusText",
        cache: true,
        type: "string",
      },
      status: {
        getter: "getStatus",
        type: "number",
      },
      ok: {
        getter: "getOK",
        type: "boolean",
      },
      bodyUsed: {
        getter: "getBodyUsed",
        type: "boolean",
      },
    },
  }),
  define({
    name: "Blob",
    // R-2 Phase 2: user impls take `&self`; emit `this: &T` shims.
    sharedThis: true,
    final: false,
    construct: true,
    finalize: true,
    JSType: "0b11101110",
    klass: {},
    configurable: false,
    lockedPrototype: true,
    types: [{ path: ["Blob"], isView: true, typeArguments: [] }],
    structuredClone: {
      transferable: false,
      tag: 254,

      // TODO: fix this.
      // We should support it unless it's a file descriptor.
      storable: true,
    },
    estimatedSize: true,
    values: ["stream"],
    overridesToJS: true,
    proto: {
      text: { fn: "getText", returns: "Promise", checkedAtRuntime: true, async: true },
      json: {
        fn: "getJSON",
        returns: "Promise",
        checkedAtRuntime: true,
        async: true,
        typedResultForm: { form: "ParsedBody", source: "this" },
      },
      arrayBuffer: { fn: "getArrayBuffer", returns: "Promise", checkedAtRuntime: true, async: true },
      slice: { fn: "getSlice", returns: "Blob", checkedAtRuntime: true, length: 2 },
      stream: { fn: "getStream", returns: "ReadableStream", checkedAtRuntime: true, length: 1 },
      formData: { fn: "getFormData", returns: "Promise", checkedAtRuntime: true, async: true },
      exists: { fn: "getExists", returns: "Promise", checkedAtRuntime: true, length: 0 },

      // Non-standard, but consistent!
      bytes: { fn: "getBytes", returns: "Promise", checkedAtRuntime: true, async: true },

      // `new Bun.Image(this, opts)` — synchronous (the read happens lazily
      // when an Image terminal is awaited), so this is just a constructor
      // call with the receiver as input. Covers BunFile/S3File.
      image: { fn: "doImage", returns: "Image", checkedAtRuntime: true, length: 0 },

      type: {
        getter: "getType",
        type: "string",
        checkedAtRuntime: true,
      },

      // TODO: Move this to a separate `File` object or BunFile
      // This is *not* spec-compliant.
      name: {
        this: true,
        cache: true,
        getter: "getName",
        type: "string | undefined | null",
        checkedAtRuntime: true,
        setter: "setName",
      },

      // TODO: Move this to a separate `File` object or BunFile
      // This is *not* spec-compliant.
      lastModified: {
        getter: "getLastModified",
        type: "number",
      },

      // Non-standard, s3 + BunFile support
      unlink: { fn: "doUnlink", returns: "Promise", checkedAtRuntime: true, length: 0 },
      delete: { fn: "doUnlink", returns: "Promise", checkedAtRuntime: true, length: 0 },
      write: { fn: "doWrite", returns: "Promise", checkedAtRuntime: true, length: 2 },
      size: {
        getter: "getSize",
        type: "number",
      },
      stat: { fn: "getStat", returns: "Promise | undefined", checkedAtRuntime: true, length: 0 },

      writer: {
        fn: "getWriter",
        returns: "object",
        checkedAtRuntime: true,
        length: 1,
      },
    },
  }),
];
