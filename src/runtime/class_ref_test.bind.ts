// Functions that exist to test b.classRef, whose classes are in this crate: test/internal/bindgen.test.ts
import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::class_ref_test" });

const SocketAddress = b.classRef("SocketAddress");

export const portOf = b.fn({ args: { address: SocketAddress }, returns: b.u16 });
export const portOfOrNull = b.fn({ args: { address: SocketAddress.nullable }, returns: b.u16.nullable });
export const portAfterCallback = b.fn({
  args: { address: SocketAddress, callback: b.callable },
  returns: b.u16,
  capability: "js",
  throws: true,
});

export const AddressOrList = b.union({ address: SocketAddress, list: b.classRef("BlockList") });
export const describeAddressOrList = b.fn({ args: { value: AddressOrList }, returns: b.string.utf8 });

export const AddressOrAnything = b.union({ address: SocketAddress, ignored: b.any });
export const isAddress = b.fn({ args: { value: AddressOrAnything }, returns: b.bool });

export const portPlus = b.overloads(
  {
    args: { address: b.classRef("SocketAddress"), more: b.u16 },
    returns: b.u32,
    rustPath: "crate::class_ref_test::port_plus_number",
  },
  {
    args: { address: b.classRef("SocketAddress"), more: b.string.utf8 },
    returns: b.u32,
    rustPath: "crate::class_ref_test::port_plus_length",
  },
);
