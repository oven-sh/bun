import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "Request",
    construct: true,
    finalize: true,
    klass: {},
    JSType: "0b11101110",
    estimatedSize: true,
    configurable: false,
    overridesToJS: true,
    memoryCost: true,
    proto: {
      text: { fn: "getText" },
      json: { fn: "getJSON" },
      bytes: { fn: "getBytes" },
      body: { getter: "getBody", cache: true },
      arrayBuffer: { fn: "getArrayBuffer" },
      formData: { fn: "getFormData" },
      blob: { fn: "getBlob" },
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
    construct: true,
    finalize: true,
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
    proto: {
      url: {
        getter: "getURL",
        cache: true,
      },
      body: { getter: "getBody", cache: true },

      text: { fn: "getText" },
      json: { fn: "getJSON" },
      bytes: { fn: "getBytes" },
      arrayBuffer: { fn: "getArrayBuffer" },
      blob: { fn: "getBlob" },
      clone: { fn: "doClone", length: 1 },
      formData: { fn: "getFormData" },

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
    final: false,
    construct: true,
    finalize: true,
    JSType: "0b11101110",
    klass: {},
    configurable: false,
    structuredClone: { transferable: false, tag: 254 },
    estimatedSize: true,
    values: ["stream"],
    overridesToJS: true,
    proto: {
      text: { fn: "getText" },
      json: { fn: "getJSON" },
      arrayBuffer: { fn: "getArrayBuffer" },
      slice: { fn: "getSlice", length: 2 },
      stream: { fn: "getStream", length: 1 },
      formData: { fn: "getFormData" },
      exists: { fn: "getExists", length: 0 },

      // Non-standard, but consistent!
      bytes: { fn: "getBytes" },

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
