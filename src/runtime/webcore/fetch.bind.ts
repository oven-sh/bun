import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::webcore::fetch" });

const js = { capability: "js", throws: true } as const;
const request = { args: { input: b.any, init: b.any }, returns: b.any, ...js, length: 1 } as const;

export const fetch = b.fn(request);
/** What `session.fetch` of a `Bun.FetchSession` is bound from. */
export const sessionFetch = b.fn({ ...request, passThis: true, export: "Bun__Fetch__sessionFetch" });
export const preconnect = b.fn({ args: { url: b.any }, ...js });
