import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";

const js = { capability: "js", throws: true } as const;
const getter = { getter: b.any.returning("string"), capability: "js" } as const;
const cached = { ...getter, cache: true, ...js } as const;
const headers = { ...cached, getter: b.any.returning("Headers") } as const;
/** Reads the whole body. The `stream` field of the receiver says whether a script already read from it. */
const read = { returns: b.any.returning("Promise"), ...js, passThis: true } as const;

/** Members of the trait `BodyMixin`. */
const body = {
  rustTraits: ["crate::webcore::body::BodyMixin"],
  arrayBuffer: read,
  blob: read,
  body: { ...cached, getter: b.any.returning("ReadableStream", "null") },
  bodyUsed: { getter: b.bool, capability: "js" },
  bytes: read,
  formData: read,
  json: { ...read, typedResultForm: { form: "ParsedBody", source: "this" } },
  text: read,
  textStream: { returns: b.any.returning("ReadableStream"), ...js },
} as const;
const clone = (name: "Request" | "Response") =>
  ({ returns: b.any.returning(name), ...js, passThis: true, rustName: "do_clone", length: 1 }) as const;

export const Request = b.class({
  rustPath: "crate::webcore::Request",
  refCounted: true,
  final: false,
  overridesToJS: true,
  rustTraits: body.rustTraits,
  memoryCost: true,
  estimatedSize: true,
  types: [table.viewType("Request"), table.exactType("$Bindgen.Request")],
  lockedObjects: ["prototype"],
  construct: { args: { input: b.any, init: b.any }, ...js, passStructure: true, length: 0 },
  internalFields: ["stream"],
  proto: {
    arrayBuffer: body.arrayBuffer,
    blob: body.blob,
    body: body.body,
    bodyUsed: body.bodyUsed,
    bytes: body.bytes,
    cache: getter,
    clone: clone("Request"),
    credentials: getter,
    destination: getter,
    formData: body.formData,
    headers,
    integrity: getter,
    json: body.json,
    method: getter,
    mode: getter,
    redirect: getter,
    referrer: getter,
    referrerPolicy: getter,
    signal: { getter: b.any.returning("AbortSignal"), capability: "js", cache: true },
    text: body.text,
    textStream: body.textStream,
    url: cached,
  },
});

const factory = { args: { args: b.any.variadic }, returns: b.any.returning("Response"), ...js } as const;

export const Response = b.class({
  rustPath: "crate::webcore::Response",
  refCounted: true,
  finalize: true,
  overridesToJS: true,
  rustTraits: body.rustTraits,
  estimatedSize: true,
  types: [table.viewType("Response"), table.exactType("$Bindgen.Response")],
  lockedObjects: ["prototype"],
  construct: { args: { body: b.any, init: b.any }, ...js, passStructure: true, length: 0 },
  internalFields: ["stream", "transform"],
  proto: {
    arrayBuffer: body.arrayBuffer,
    blob: body.blob,
    body: body.body,
    bodyUsed: body.bodyUsed,
    bytes: body.bytes,
    clone: clone("Response"),
    formData: body.formData,
    headers,
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
    error: { returns: b.any.returning("Response"), capability: "js" },
    /** `Response.json()` is an empty body and `Response.json(undefined)` throws. */
    json: {
      ...factory,
      rustName: "construct_json",
      jsonTextForm: { argument: 0, nativeSymbol: "Response__constructJSONFromText" },
    },
    /** `Response.redirect()` is to "" and `Response.redirect(undefined)` to "undefined". */
    redirect: factory,
  },
});

/** `Response.json(value, init)` for compiled code that has already serialized `value`: argument 0 is the JSON text (`jsonTextForm`). */
export const constructJSONFromText = b.fn({
  ...factory,
  export: "Response__constructJSONFromText",
  rustPath: "crate::webcore::response::construct_json_from_text",
});
