// Tests a class imported from another `.bind.ts` as an argument type: test/internal/bindgen.test.ts
import * as b from "../codegen/bindgen-lib.ts";
import { BlockList } from "./node/net/BlockList.bind.ts";
import { SocketAddress } from "./socket/SocketAddress.bind.ts";

export default b.module({ rustPath: "crate::imported_class_test" });

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
