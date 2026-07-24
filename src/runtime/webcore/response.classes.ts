import { define } from "../../codegen/class-definitions";

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
      json: { fn: "getJSON", async: true },
      bytes: { fn: "getBytes", async: true },
      body: { getter: "getBody", cache: true },
      arrayBuffer: { fn: "getArrayBuffer", async: true },
      formData: { fn: "getFormData", async: true },
      blob: { fn: "getBlob", async: true },
      clone: { fn: "doClone", length: 1 },
      cache: {
        getter: "getCache",
      },
      credentials: {
        getter: "getCredentials",
      },
      destination: {
        getter: "getDestination",
      },
      headers: {
        getter: "getHeaders",
        cache: true,
      },
      integrity: {
        getter: "getIntegrity",
      },
      method: {
        getter: "getMethod",
      },
      mode: {
        getter: "getMode",
      },
      redirect: {
        getter: "getRedirect",
      },
      referrer: {
        getter: "getReferrer",
      },
      referrerPolicy: {
        getter: "getReferrerPolicy",
      },
      url: {
        getter: "getUrl",
        cache: true,
      },
      bodyUsed: {
        getter: "getBodyUsed",
      },
      signal: {
        getter: "getSignal",
        cache: true,
      },
    },
  }),
  define({
    name: "Response",
    // R-2 Phase 2: user impls take `&self`; emit `this: &T` shims.
    sharedThis: true,
    construct: true,
    constructNeedsThis: true,
    finalize: true,
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
    values: ["stream"],
    proto: {
      url: {
        getter: "getURL",
        cache: true,
      },
      body: { getter: "getBody", cache: true },

      text: { fn: "getText", async: true },
      json: { fn: "getJSON", async: true },
      bytes: { fn: "getBytes", async: true },
      arrayBuffer: { fn: "getArrayBuffer", async: true },
      blob: { fn: "getBlob", async: true },
      formData: { fn: "getFormData", async: true },

      clone: { fn: "doClone", length: 1 },

      type: {
        getter: "getResponseType",
      },
      headers: {
        getter: "getHeaders",
        cache: true,
      },
      redirected: {
        getter: "getRedirected",
      },
      statusText: {
        getter: "getStatusText",
        cache: true,
      },
      status: {
        getter: "getStatus",
      },
      ok: {
        getter: "getOK",
      },
      bodyUsed: {
        getter: "getBodyUsed",
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
    // `name` is a cached WriteBarrier on the instance even though the
    // accessor lives on File.prototype (JSDOMFile.cpp), so that
    // `Bun.file()` / `new File()` can cache their name string.
    values: ["stream", "name"],
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

      // `name` and `lastModified` live on File.prototype (JSDOMFile.cpp),
      // not here — https://github.com/oven-sh/bun/issues/20700

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
