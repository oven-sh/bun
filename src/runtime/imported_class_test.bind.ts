// Functions that exist to test arguments that are instances of a class of another schema: test/internal/bindgen.test.ts
import * as b from "../codegen/bindgen-lib.ts";
import { BlockList } from "./node/net/BlockList.bind.ts";
import { SocketAddress } from "./socket/SocketAddress.bind.ts";

export default b.module({ rustPath: "crate::class_ref_test" });

export const portOf = b.fn({ args: { address: SocketAddress }, returns: b.u16 });
export const portOfOrNull = b.fn({ args: { address: SocketAddress.nullable }, returns: b.u16.nullable });
export const portAfterCallback = b.fn({
  args: { address: SocketAddress, callback: b.callable },
  returns: b.u16,
  capability: "js",
  throws: true,
});

export const AddressOrList = b.union({ address: SocketAddress, list: BlockList });
export const describeAddressOrList = b.fn({ args: { value: AddressOrList }, returns: b.string.utf8 });

export const AddressOrAnything = b.union({ address: SocketAddress, ignored: b.any });
export const isAddress = b.fn({ args: { value: AddressOrAnything }, returns: b.bool });

export const portPlus = b.overloads(
  {
    args: { address: SocketAddress, more: b.u16 },
    returns: b.u32,
    rustPath: "crate::class_ref_test::port_plus_number",
  },
  {
    args: { address: SocketAddress, more: b.string.utf8 },
    returns: b.u32,
    rustPath: "crate::class_ref_test::port_plus_length",
  },
);
