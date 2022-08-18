import { define } from "../scripts/class-definitions";

export default [
  define({
    name: "Request",
    construct: true,
    finalize: true,
    klass: {},
    JSType: "0b11101110",
    proto: {
      // body: {
      //     getter: "getBody",
      // },

      text: { fn: "getText" },
      json: { fn: "getJSON" },
      arrayBuffer: { fn: "getArrayBuffer" },
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
    },
  }),
  define({
    name: "Response",
    construct: true,
    finalize: true,
    JSType: "0b11101110",
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

      // body: {
      //     getter: "getBody",
      // },

      text: { fn: "getText" },
      json: { fn: "getJSON" },
      arrayBuffer: { fn: "getArrayBuffer" },
      blob: { fn: "getBlob" },
      clone: { fn: "doClone", length: 1 },

      type: {
        getter: "getResponseType",
      },
      headers: {
        getter: "getHeaders",
        cache: true,
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
];
