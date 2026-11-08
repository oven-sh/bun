import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::webcore::fetch" });

const js = { capability: "js", throws: true } as const;
/** An `input` that is neither a `Request` nor, after `ToString`, a URL is read as `init` is. */
const request = {
  args: { input: b.any, init: b.any },
  returns: b.any,
  ...js,
  rejects: true,
  requiredArguments: 1,
} as const;

export const fetch = b.fn(request);
/** What `session.fetch` of a `Bun.FetchSession` is bound from. */
export const sessionFetch = b.fn({ ...request, passThis: true, export: "Bun__Fetch__sessionFetch" });
export const preconnect = b.fn({ args: { url: b.string.loose }, ...js, requiredArguments: 1 });
