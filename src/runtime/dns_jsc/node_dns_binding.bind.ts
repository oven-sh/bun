import * as b from "../../codegen/bindgen-lib.ts";
import { LookupOptions } from "./dns.bind.ts";
import { DNSResolver } from "./dns_internals.bind.ts";

export default b.module({ rustPath: "crate::dns_jsc::Resolver" });

const method = { capability: "js", throws: true } as const;

/** Which of the `resolveSrv()`-style queries `queryCb` starts: the name of its method. */
export const QueryMethod = b.enumeration([
  "resolveAny",
  "resolveCaa",
  "resolveCname",
  "resolveMx",
  "resolveNaptr",
  "resolveNs",
  "resolvePtr",
  "resolveSoa",
  "resolveSrv",
  "resolveTxt",
]);

/** A `DNSResolver`, or nothing for the VM's global resolver. */
const resolver = DNSResolver.nullable;

/**
 * The callback forms of `node:dns`: the default export of `src/js/internal/dns/binding.ts`. Each starts what the
 * promise-returning function of `Bun.dns` or of `DNSResolver` starts, with the same arguments after `callback`, and
 * returns nothing. The answer goes to `callback(error)` or `callback(null, value)`, which is called from the event
 * loop and never before the call returns.
 */
export const callbackForms = b.namespace({
  lookupCb: {
    ...method,
    args: { callback: b.callable, hostname: b.string.utf8, options: LookupOptions.nullable.default({}) },
  },
  lookupServiceCb: {
    ...method,
    args: { callback: b.callable, address: b.string.utf8, port: b.f64 },
    expected: { address: ["string"], port: ["number"] },
  },
  resolveCb: {
    ...method,
    args: { callback: b.callable, resolver, name: b.string.utf8, record: b.string.utf8.otherAsNull },
    expected: { name: ["string"] },
  },
  queryCb: {
    ...method,
    args: { callback: b.callable, resolver, method: QueryMethod, hostname: b.string.utf8 },
    expected: { hostname: ["string"] },
  },
  reverseCb: {
    ...method,
    args: { callback: b.callable, resolver, ip: b.string.utf8 },
    expected: { ip: ["string"] },
  },
});
