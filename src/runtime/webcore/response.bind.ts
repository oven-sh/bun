import * as b from "../../codegen/bindgen-lib.ts";

const js = { capability: "js", throws: true } as const;
const method = { returns: b.any, ...js } as const;
const getter = { getter: b.any, capability: "js" } as const;
const cached = { getter: b.any, cache: true, ...js } as const;
/** Reads the whole body. The `stream` field of the receiver says whether a script already read from it. */
const read = { ...method, passThis: true } as const;

/** Members of the trait `BodyMixin`. */
const body = {
  rustTraits: ["crate::webcore::body::BodyMixin"],
  arrayBuffer: read,
  blob: read,
  body: cached,
  bodyUsed: { getter: b.bool, capability: "js" },
  bytes: read,
  formData: read,
  json: read,
  text: read,
  textStream: method,
} as const;
const clone = { ...method, passThis: true, rustName: "do_clone", length: 1 } as const;

export const Request = b.class({
  rustPath: "crate::webcore::Request",
  refCounted: true,
  final: false,
  overridesToJS: true,
  rustTraits: body.rustTraits,
  memoryCost: true,
  estimatedSize: true,
  construct: { args: { input: b.any, init: b.any }, ...js, passStructure: true, length: 0 },
  internalFields: ["stream"],
  proto: {
    arrayBuffer: body.arrayBuffer,
    blob: body.blob,
    body: body.body,
    bodyUsed: body.bodyUsed,
    bytes: body.bytes,
    cache: getter,
    clone,
    credentials: getter,
    destination: getter,
    formData: body.formData,
    headers: cached,
    integrity: getter,
    json: body.json,
    method: getter,
    mode: getter,
    redirect: getter,
    referrer: getter,
    referrerPolicy: getter,
    signal: { ...getter, cache: true },
    text: body.text,
    textStream: body.textStream,
    url: cached,
  },
});

export const Response = b.class({
  rustPath: "crate::webcore::Response",
  refCounted: true,
  finalize: true,
  overridesToJS: true,
  rustTraits: body.rustTraits,
  estimatedSize: true,
  construct: { args: { body: b.any, init: b.any }, ...js, passStructure: true, length: 0 },
  internalFields: ["stream", "transform"],
  proto: {
    arrayBuffer: body.arrayBuffer,
    blob: body.blob,
    body: body.body,
    bodyUsed: body.bodyUsed,
    bytes: body.bytes,
    clone,
    formData: body.formData,
    headers: cached,
    json: body.json,
    ok: { getter: b.bool },
    redirected: { getter: b.bool },
    status: { getter: b.u16 },
    statusText: cached,
    text: body.text,
    textStream: body.textStream,
    type: getter,
    url: cached,
  },
  static: {
    error: { returns: b.any, capability: "js" },
    /** `Response.json()` is an empty body and `Response.json(undefined)` throws. */
    json: { ...method, args: { args: b.any.variadic }, rustName: "construct_json" },
    /** `Response.redirect()` is to "" and `Response.redirect(undefined)` to "undefined". */
    redirect: { ...method, args: { args: b.any.variadic } },
  },
});
