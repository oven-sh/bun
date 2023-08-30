import { define } from "../scripts/class-definitions";

export default [
  define({
    name: "Request",
    construct: true,
    finalize: true,
    klass: {},
    JSType: "0b11101110",
    estimatedSize: true,
    configurable: false,
    proto: {
      text: { fn: "getText" },
      json: { fn: "getJSON" },
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
    construct: true,
    finalize: true,
    JSType: "0b11101110",
    klass: {},
    configurable: false,
    structuredClone: { transferable: false, tag: 254 },
    estimatedSize: true,
    proto: {
      text: { fn: "getText" },
      json: { fn: "getJSON" },
      arrayBuffer: { fn: "getArrayBuffer" },
      slice: { fn: "getSlice", length: 2 },
      stream: { fn: "getStream", length: 1 },
      formData: { fn: "getFormData" },
      exists: { fn: "getExists", length: 0 },

      type: {
        getter: "getType",
      },

      // TODO: Move this to a separate `File` object or BunFile
      // This is *not* spec-compliant.
      name: {
        getter: "getName",
        cache: true,
      },

      // TODO: Move this to a separate `File` object or BunFile
      // This is *not* spec-compliant.
      lastModified: {
        getter: "getLastModified",
      },

      size: {
        getter: "getSize",
      },

      writer: {
        fn: "getWriter",
        length: 1,
      },
    },
  }),
];
