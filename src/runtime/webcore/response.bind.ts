import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";
import { Image } from "../image/Image.bind.ts";
import { ReadableStream } from "./ByteStream.bind.ts";

const js = { capability: "js", throws: true } as const;
const getter = { getter: b.string.local, capability: "js" } as const;
const cached = { ...getter, cache: true, ...js } as const;
const headers = { ...cached, getter: b.object.returning("Headers") } as const;
/** Reads the whole body. The `stream` field of the receiver says whether a script already read from it. */
const read = { returns: b.promise, ...js, passThis: true } as const;

/** Members of the trait `BodyMixin`. */
const body = {
  rustTraits: ["crate::webcore::body::BodyMixin"],
  arrayBuffer: read,
  blob: read,
  body: { ...cached, getter: b.opaque.returning("ReadableStream", "null") },
  bodyUsed: { getter: b.bool, capability: "js" },
  bytes: read,
  formData: read,
  json: { ...read, typedResultForm: { form: "ParsedBody", source: "this" } },
  text: read,
  textStream: { returns: b.object.returning("ReadableStream"), ...js },
} as const;

export const JSDOMURL = b.cell("WebCore::JSDOMURL", "JSDOMURL.h", { rustPath: "bun_jsc::JSObject" });
export const Headers = b.wrapped("WebCore::JSFetchHeaders", "JSFetchHeaders.h", {
  rustPath: "bun_jsc::FetchHeaders",
  reportedAs: "Headers",
}).withValue;

/** By name: their schemas import this one. */
const Blob = b.wrapped("Bun::Bindgen::Generated::JSBlob", "GeneratedBlob.h", {
  rustPath: "bun_jsc::webcore_types::Blob",
});
const BuildArtifact = b.wrapped("Bun::Bindgen::Generated::JSBuildArtifact", "GeneratedJSBundler.h", {
  rustPath: "crate::api::js_bundler::BuildArtifact",
  tsType: "Bun.BuildArtifact",
});
/**
 * It is also a member of a dictionary, where an instance comes with its value: `.withValue`.
 * A `DataView` is not among the buffers: like `object`, it is an async iterable or else the parts of a `Blob`, as `other` is.
 */
export const BodyInit = b.union(
  {
    undefined: b.undefined,
    null: b.null,
    string: b.stringLike,
    dataView: b.dataView,
    buffer: b.bufferSource.allowShared,
    formData: b.wrapped("WebCore::JSDOMFormData", "JSDOMFormData.h", {
      rustPath: "bun_jsc::DOMFormData",
      reportedAs: "FormData",
    }).withValue,
    urlSearchParams: b.wrapped("WebCore::JSURLSearchParams", "JSURLSearchParams.h", {
      rustPath: "bun_jsc::URLSearchParams",
    }).withValue,
    blob: Blob.withValue,
    buildArtifact: BuildArtifact.withValue,
    image: Image.withValue,
    readableStream: ReadableStream,
    object: b.object,
    other: b.opaque,
  },
  { fromJS: true },
);

/** `headers` is copied. `init` is converted as the `HeadersInit` of the Fetch standard. */
export const HeadersInit = b.union({ missing: b.undefined, headers: Headers, init: b.opaque });
export const ResponseInit = b.dictionary(
  {
    headers: b.opaque.optional,
    status: b.opaque.optional,
    statusText: b.string.loose.emptyStringAsNull,
    method: b.string.loose.emptyStringAsNull,
  },
  { deferred: true },
);
export const ResponseInitArgument = b.union({ missing: b.null, init: ResponseInit, other: b.ignored });
export const ResponseInitOrStatus = b.union({ status: b.f64, init: ResponseInit, other: b.ignored });

export const SignalInit = b.union({
  missing: b.undefined,
  null: b.null,
  signal: b.abortSignal.shared,
  other: b.ignored,
});
/** Members of the `RequestInit` of the Fetch standard. */
export const RequestInit = b.dictionary(
  { body: BodyInit, url: b.string.loose.optional, signal: SignalInit },
  { deferred: true },
);

const clone = { returns: b.self, ...js, passThis: true, rustName: "do_clone", length: 1 } as const;

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
  construct: { args: { input: b.opaque, init: b.opaque }, ...js, passStructure: true, length: 0 },
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
    headers,
    integrity: getter,
    json: body.json,
    method: getter,
    mode: getter,
    redirect: getter,
    referrer: getter,
    referrerPolicy: getter,
    signal: { getter: b.object.returning("AbortSignal"), capability: "js", cache: true },
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
  types: [table.viewType("Response"), table.exactType("$Bindgen.Response")],
  lockedObjects: ["prototype"],
  construct: { args: { body: BodyInit, init: ResponseInitArgument }, ...js, passStructure: true, length: 0 },
  internalFields: ["stream", "transform"],
  proto: {
    arrayBuffer: body.arrayBuffer,
    blob: body.blob,
    body: body.body,
    bodyUsed: body.bodyUsed,
    bytes: body.bytes,
    clone,
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
    error: { returns: b.self, capability: "js" },
    /** `Response.json()` is an empty body and `Response.json(undefined)` throws. */
    json: {
      ...js,
      args: { data: b.opaque.ifPassed, init: ResponseInitOrStatus },
      returns: b.self,
      rustName: "construct_json",
      jsonTextForm: { argument: 0, nativeSymbol: "Response__constructJSONFromText" },
      length: 0,
    },
    /** `Response.redirect()` is to "" and `Response.redirect(undefined)` to "undefined". */
    redirect: {
      ...js,
      args: { url: b.string.loose.ifPassed, init: ResponseInitOrStatus },
      returns: b.self,
      length: 0,
    },
  },
});

/** `Response.json(value, init)` for compiled code that has already serialized `value`: argument 0 is the JSON text (`jsonTextForm`). */
export const constructJSONFromText = b.fn({
  ...js,
  args: { data: b.opaque.ifPassed, init: ResponseInitOrStatus },
  returns: b.opaque.returning("Response"),
  export: "Response__constructJSONFromText",
  rustPath: "crate::webcore::response::construct_json_from_text",
});
