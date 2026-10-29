import * as b from "../../codegen/bindgen-lib.ts";
import { BodyInit, Headers } from "./response.bind.ts";

export default b.module({ rustPath: "crate::webcore::fetch" });

const js = { capability: "js", throws: true } as const;

/** A number is `false` when it truncates to 0. */
export const FlagOrNumber = b.union({ flag: b.bool, number: b.f64, other: b.ignored });
export const MaxRedirects = b.union({ none: b.null, number: b.f64, other: b.ignored });
export const FetchVerbose = b.union({ string: b.stringLike, flag: b.bool, other: b.ignored });
export const SignalInit = b.union({
  missing: b.undefined,
  none: b.null,
  signal: b.abortSignal.shared,
  other: b.ignored,
});
/** `headers` is copied. `other` is converted as the `HeadersInit` of the Fetch standard. */
export const HeadersInit = b.union({ missing: b.undefined, headers: Headers, other: b.opaque });
export const FetchInit = b.dictionary(
  {
    url: b.string.loose.optional,
    method: b.string.loose.emptyStringAsNull,
    decompress: FlagOrNumber,
    compress: b.opaque.optional,
    maxRedirects: MaxRedirects,
    session: b.opaque.nullable,
    tls: b.object.otherAsNull,
    unix: b.opaque.optional,
    protocol: b.stringLike.otherAsNull,
    timeout: FlagOrNumber,
    redirect: b.opaque.nullable,
    keepalive: FlagOrNumber,
    verbose: FetchVerbose,
    proxy: b.opaque.optional,
    signal: SignalInit,
    body: BodyInit,
    headers: HeadersInit,
    s3: b.object.otherAsNull,
  },
  { deferred: true },
);
export const FetchInput = b.union({ text: b.string.allowStringObject, init: FetchInit, other: b.opaque });
/** An `input` that is neither a `Request` nor, after `ToString`, a URL is read as `init` is. */
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
