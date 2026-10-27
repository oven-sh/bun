import * as b from "../../codegen/bindgen-lib.ts";
import { Image } from "../image/Image.bind.ts";
import { ReadableStream } from "./ByteStream.bind.ts";

const js = { capability: "js", throws: true } as const;
const method = { returns: b.promise, ...js } as const;
const getter = { getter: b.string.local, capability: "js" } as const;
const cached = { getter: b.object, cache: true, ...js } as const;
const cachedString = { getter: b.string.local, cache: true, ...js } as const;
/** Reads the whole body. The `stream` field of the receiver says whether a script already read from it. */
const read = { ...method, passThis: true } as const;

/** Members of the trait `BodyMixin`. */
const body = {
  rustTraits: ["crate::webcore::body::BodyMixin"],
  arrayBuffer: read,
  blob: read,
  /** `null`, or a `ReadableStream`. */
  body: { ...cached, getter: b.opaque },
  bodyUsed: { getter: b.bool, capability: "js" },
  bytes: read,
  formData: read,
  json: read,
  text: read,
  textStream: { ...method, returns: b.object },
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

/** `headers` is copied. `init` is what `FetchHeaders::create_from_js` takes. */
export const HeadersInit = b.union({ missing: b.undefined, headers: Headers, init: b.opaque });
/** `other` is `ToInt32`. */
export const ResponseStatus = b.union({
  missing: b.undefined,
  bigInt: b.i64.asIntN,
  number: b.f64,
  other: b.i32.wrap,
});
export const ResponseInit = b.dictionary(
  {
    headers: HeadersInit,
    status: ResponseStatus,
    statusText: b.string.loose.emptyStringAsNull,
    method: b.string.loose.emptyStringAsNull,
  },
  { deferred: true },
);
export const ResponseInitArgument = b.union({ missing: b.null, init: ResponseInit, other: b.ignored });
export const ResponseInitOrStatus = b.union({ missing: b.null, status: b.f64, init: ResponseInit, other: b.ignored });

export const SignalInit = b.union({
  missing: b.undefined,
  null: b.null,
  signal: b.abortSignal.shared,
  other: b.ignored,
});
/** The name of a value of one of the enumerations of `bun_http_types`. */
const optionName = (name: string) => ({ type: b.stringLike.nullable, expected: `${name} must be a string` });
/** `response::Init` reads `headers` and `method`, as a `ResponseInit`. Here they only say whether they are there. */
export const RequestInit = b.dictionary(
  {
    body: BodyInit,
    keepalive: b.bool.loose.default(false),
    url: b.string.loose.optional,
    signal: SignalInit,
    headers: b.opaque.optional,
    method: b.opaque.optional,
    redirect: optionName("redirect"),
    cache: optionName("cache"),
    mode: optionName("mode"),
  },
  { deferred: true },
);
export const RequestInput = b.union({
  string: b.stringLike,
  url: JSDOMURL,
  symbol: b.symbol,
  bigInt: b.bigInt,
  object: RequestInit,
  other: b.ignored,
});
/** What `JSON.stringify` makes `undefined` of, or throws for, is refused by name. */
export const JsonValue = b.union({
  undefined: b.undefined,
  symbol: b.symbol,
  function: b.cell("JSC::JSFunction", "JavaScriptCore/JSFunction.h", { rustPath: "bun_jsc::JSObject" }),
  bigInt: b.bigInt,
  value: b.opaque,
});

const clone = { ...js, returns: b.self, passThis: true, rustName: "do_clone", length: 1 } as const;

export const Request = b.class({
  rustPath: "crate::webcore::Request",
  refCounted: true,
  final: false,
  overridesToJS: true,
  rustTraits: body.rustTraits,
  memoryCost: true,
  estimatedSize: true,
  construct: { args: { input: RequestInput, init: RequestInit.otherAsNull }, ...js, passStructure: true, length: 0 },
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
    signal: { getter: b.object, cache: true, capability: "js" },
    text: body.text,
    textStream: body.textStream,
    url: cachedString,
  },
});

export const Response = b.class({
  rustPath: "crate::webcore::Response",
  refCounted: true,
  finalize: true,
  overridesToJS: true,
  rustTraits: body.rustTraits,
  estimatedSize: true,
  construct: {
    args: { body: BodyInit, init: ResponseInitArgument },
    ...js,
    passStructure: true,
    length: 0,
  },
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
    statusText: cachedString,
    text: body.text,
    textStream: body.textStream,
    type: getter,
    url: cachedString,
  },
  static: {
    error: { returns: b.self, capability: "js" },
    /** `Response.json()` is an empty body and `Response.json(undefined)` throws. */
    json: {
      ...js,
      args: { data: JsonValue.ifPassed, init: ResponseInitOrStatus },
      returns: b.self,
      rustName: "construct_json",
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
