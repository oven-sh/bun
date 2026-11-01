import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";

/** `net.SocketAddress`. */
export const SocketAddress = b.class({
  rustPath: "crate::socket::SocketAddress",
  configurable: true,
  enumerable: false,
  types: [table.exactType("$Node.SocketAddress"), table.exactType("$Bindgen.SocketAddress")],
  construct: { args: { options: b.any }, capability: "js", throws: true, length: 0 },
  proto: {
    address: { getter: b.any.returning("string"), cache: true, capability: "js", throws: true },
    addrfamily: { getter: b.u16, configurable: false, pure: true },
    family: { getter: b.string.local, cache: true, capability: "heap" },
    flowlabel: { getter: b.u32, pure: true },
    port: { getter: b.u16, pure: true },
    toJSON: { returns: b.any.returning("object"), capability: "js", throws: true },
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
