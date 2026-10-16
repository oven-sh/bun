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
    overridesToJS: true,
    memoryCost: true,
    values: ["stream"],
    proto: {
      text: { fn: "getText", async: true },
      textStream: { fn: "getTextStream" },
      json: { fn: "getJSON", async: true },
      bytes: { fn: "getBytes", async: true },
      body: { getter: "getBody", cache: true, type: "ReadableStream | null" },
      arrayBuffer: { fn: "getArrayBuffer", async: true },
      formData: { fn: "getFormData", async: true },
      blob: { fn: "getBlob", async: true },
      clone: { fn: "doClone", length: 1 },
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
    estimatedSize: true,
    overridesToJS: true,
    klass: {
      json: {
        fn: "constructJSON",
      },
      redirect: {
        fn: "constructRedirect",
      },
      error: {
        fn: "constructError",
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

      text: { fn: "getText", async: true },
      textStream: { fn: "getTextStream" },
      json: { fn: "getJSON", async: true },
      bytes: { fn: "getBytes", async: true },
      arrayBuffer: { fn: "getArrayBuffer", async: true },
      blob: { fn: "getBlob", async: true },
      formData: { fn: "getFormData", async: true },

      clone: { fn: "doClone", length: 1 },

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
      text: { fn: "getText", async: true },
      json: { fn: "getJSON", async: true },
      arrayBuffer: { fn: "getArrayBuffer", async: true },
      slice: { fn: "getSlice", length: 2 },
      stream: { fn: "getStream", length: 1 },
      formData: { fn: "getFormData", async: true },
      exists: { fn: "getExists", length: 0 },

      // Non-standard, but consistent!
      bytes: { fn: "getBytes", async: true },

      // `new Bun.Image(this, opts)` — synchronous (the read happens lazily
      // when an Image terminal is awaited), so this is just a constructor
      // call with the receiver as input. Covers BunFile/S3File.
      image: { fn: "doImage", length: 0 },

      type: {
        getter: "getType",
      },

      // TODO: Move this to a separate `File` object or BunFile
      // This is *not* spec-compliant.
      name: {
        this: true,
        cache: true,
        getter: "getName",
        setter: "setName",
      },

      // TODO: Move this to a separate `File` object or BunFile
      // This is *not* spec-compliant.
      lastModified: {
        getter: "getLastModified",
      },

      // Non-standard, s3 + BunFile support
      unlink: { fn: "doUnlink", length: 0 },
      delete: { fn: "doUnlink", length: 0 },
      write: { fn: "doWrite", length: 2 },
      size: {
        getter: "getSize",
      },
      stat: { fn: "getStat", length: 0 },

      writer: {
        fn: "getWriter",
        length: 1,
      },
    },
  }),
];
