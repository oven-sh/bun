import * as b from "../../codegen/bindgen-lib.ts";
import { S3Options } from "./Blob.bind.ts";
import { FetchSession, FetchTLS, FlagOrNumber, ProxyInit } from "./fetch/FetchSession.bind.ts";
import { BodyInit, HeadersInit, SignalInit } from "./response.bind.ts";

export default b.module({ rustPath: "crate::webcore::fetch" });

const js = { capability: "js", throws: true } as const;

export const CompressEncodingName = b.union({ name: b.string.allowStringObject, other: b.opaque });
export const CompressOptions = b.dictionary(
  {
    encoding: CompressEncodingName,
    /** Its range is the one of `encoding`. */
    level: b.opaque.nullable,
  },
  { deferred: true },
);
export const CompressInit = b.union({
  missing: b.undefined,
  null: b.null,
  flag: b.bool,
  name: b.string.allowStringObject,
  options: CompressOptions,
  other: b.opaque,
});
export const MaxRedirects = b.union({ missing: b.null, number: b.f64, other: b.ignored });
export const FetchVerbose = b.union({ string: b.stringLike, flag: b.bool, other: b.ignored });
export const FetchInit = b.dictionary(
  {
    url: b.string.loose.optional,
    method: b.string.loose.emptyStringAsNull,
    decompress: FlagOrNumber,
    compress: CompressInit,
    maxRedirects: MaxRedirects,
    session: { type: FetchSession.withValue.nullable, expected: "fetch: 'session' must be a Bun.FetchSession" },
    tls: FetchTLS.otherAsNull,
    unix: b.opaque.optional,
    protocol: b.stringLike.otherAsNull,
    timeout: FlagOrNumber,
    redirect: { type: b.stringLike.nullable, expected: "redirect must be a string" },
    keepalive: FlagOrNumber,
    verbose: FetchVerbose,
    proxy: ProxyInit,
    signal: SignalInit,
    body: BodyInit,
    headers: HeadersInit,
    s3: S3Options.otherAsNull,
  },
  { deferred: true },
);
/** An `object` that is neither a `Request` nor, after `ToString`, a URL is read as `init` is. */
export const FetchInput = b.union({ text: b.string.allowStringObject, object: FetchInit, other: b.opaque });
const request = {
  args: { input: FetchInput, init: FetchInit.otherAsNull },
  returns: b.promise,
  ...js,
  rejects: true,
  requiredArguments: 1,
} as const;

export const fetch = b.fn(request);
/** What `session.fetch` of a `Bun.FetchSession` is bound from. */
export const sessionFetch = b.fn({ ...request, passThis: true, export: "Bun__Fetch__sessionFetch" });
export const preconnect = b.fn({ args: { url: b.string.loose }, ...js, requiredArguments: 1 });
