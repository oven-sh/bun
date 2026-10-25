import * as b from "../../codegen/bindgen-lib.ts";

/** `net.SocketAddress`. */
export const SocketAddress = b.class({
  rustPath: "crate::socket::SocketAddress",
  configurable: true,
  enumerable: false,
  construct: { args: { options: b.any }, capability: "js", throws: true, length: 0 },
  proto: {
    address: { getter: b.any, cache: true, capability: "js", throws: true },
    addrfamily: { getter: b.u16, configurable: false },
    family: { getter: b.string.local, cache: true, capability: "heap" },
    flowlabel: { getter: b.u32 },
    port: { getter: b.u16 },
    toJSON: { returns: b.any, capability: "js", throws: true },
  },
  static: {
    /** `false` for an instance of a subclass. */
    isSocketAddress: { args: { value: b.any }, returns: b.bool },
    /** `undefined` if `input` is not an address with an optional `:port`. */
    parse: {
      args: { input: b.string.allowStringObject },
      expected: { input: ["string"] },
      returns: b.self.optional,
      capability: "heap",
    },
  },
});
