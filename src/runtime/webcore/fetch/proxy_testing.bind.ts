import * as b from "../../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::webcore::fetch::proxy_testing" });

export const noProxyMatches = b.fn({
  args: { list: b.string.loose.utf8, hostname: b.string.loose.utf8, port: b.u16 },
  returns: b.bool,
});

export const proxyFor = b.fn({
  args: { entries: b.array(b.string.loose.utf8.owned), url: b.string.loose.utf8 },
  returns: b.string.local.nullable,
  capability: "heap",
  throws: true,
});

export const parseURL = b.fn({ args: { href: b.string.loose.utf8 }, returns: b.record(b.string.utf8) });
