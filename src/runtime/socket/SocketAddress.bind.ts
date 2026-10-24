import * as b from "../../codegen/bindgen-lib.ts";

/** `"ipv4"` or `"ipv6"` in any case, or the number of the address family. An error shows what is neither. */
export const SocketAddressFamily = b.union({
  missing: b.undefined,
  name: b.string.allowStringObject,
  number: b.f64,
  other: b.opaque,
});
/** An error shows what is not a number. */
export const SocketAddressNumber = b.union({ missing: b.undefined, number: b.f64, other: b.opaque });
export const SocketAddressOptions = b.dictionary(
  {
    address: { type: b.string.allowStringObject.optional, expected: ["string"] },
    family: SocketAddressFamily,
    port: SocketAddressNumber,
    flowlabel: SocketAddressNumber,
  },
  { deferred: true, reportedAs: "options" },
);

export const SocketAddressJSON = b.dictionary({
  address: b.string.local,
  family: b.string.local,
  port: b.u16,
  flowlabel: b.u32,
});

/** `net.SocketAddress`. */
export const SocketAddress = b.class({
  rustPath: "crate::socket::SocketAddress",
  configurable: true,
  enumerable: false,
  construct: {
    args: { options: SocketAddressOptions.optional },
    expected: { options: ["object"] },
    capability: "js",
    throws: true,
  },
  proto: {
    address: { getter: b.string.local, cache: true, capability: "heap", throws: true },
    addrfamily: { getter: b.u16, configurable: false },
    family: { getter: b.string.local, cache: true, capability: "heap" },
    flowlabel: { getter: b.u32 },
    port: { getter: b.u16 },
    toJSON: { returns: SocketAddressJSON, capability: "heap", throws: true },
  },
  static: {
    /** `false` for an instance of a subclass. */
    isSocketAddress: { args: { value: b.object.otherAsNull }, returns: b.bool, length: 1 },
    /** `undefined` if `input` is not an address with an optional `:port`. */
    parse: {
      args: { input: b.string.allowStringObject },
      expected: { input: ["string"] },
      returns: b.self.optional,
      capability: "heap",
    },
  },
});
