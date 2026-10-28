import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";

export const SocketAddressOptions = b.dictionary(
  {
    address: { type: b.string.allowStringObject.optional, expected: ["string"] },
    family: b.opaque.optional,
    port: b.opaque.optional,
    flowlabel: b.opaque.optional,
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
  types: [table.exactType("$Node.SocketAddress"), table.exactType("$Bindgen.SocketAddress")],
  construct: {
    args: { options: SocketAddressOptions.optional },
    expected: { options: ["object"] },
    capability: "js",
    throws: true,
  },
  proto: {
    address: { getter: b.string.local, cache: true, capability: "heap", throws: true },
    addrfamily: { getter: b.u16, configurable: false, pure: true },
    family: { getter: b.string.local, cache: true, capability: "heap" },
    flowlabel: { getter: b.u32, pure: true },
    port: { getter: b.u16, pure: true },
    toJSON: { returns: SocketAddressJSON, capability: "heap", throws: true },
  },
  static: {
    /** `false` for an instance of a subclass. */
    isSocketAddress: { args: { value: b.opaque }, returns: b.bool },
    /** `undefined` if `input` is not an address with an optional `:port`. */
    parse: {
      args: { input: b.string.allowStringObject },
      expected: { input: ["string"] },
      returns: b.self.optional,
      capability: "heap",
    },
  },
});
