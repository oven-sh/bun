import * as b from "../../../codegen/bindgen-lib.ts";
import { SocketAddress } from "../../socket/SocketAddress.bind.ts";

const js = { capability: "js", throws: true } as const;

/** An error shows what is none of them. A `String` object is converted once the kind of every argument is checked. */
export const BlockListAddress = b.union({
  address: SocketAddress,
  text: b.jsString,
  stringObject: b.stringObject,
  other: b.opaque,
});
/** `"ipv4"` or `"ipv6"` in any case. It is not looked at if the address is a `SocketAddress`. */
export const BlockListFamily = b.union({
  ipv4: b.undefined,
  text: b.jsString,
  stringObject: b.stringObject,
  other: b.opaque,
});
/** The range depends on the family of the network. */
export const BlockListPrefix = b.union({ number: b.f64, other: b.opaque });

/** `net.BlockList`. A structured clone shares the struct. */
export const BlockList = b.class({
  rustPath: "crate::node::net::block_list::BlockList",
  refCounted: true,
  estimatedSize: true,
  construct: {},
  proto: {
    addAddress: { ...js, args: { address: BlockListAddress, family: BlockListFamily }, length: 1 },
    addRange: {
      ...js,
      args: { start: BlockListAddress.withValue, end: BlockListAddress, family: BlockListFamily },
      length: 2,
    },
    addSubnet: {
      ...js,
      args: { network: BlockListAddress, prefix: BlockListPrefix, family: BlockListFamily },
      length: 2,
    },
    check: { ...js, args: { address: BlockListAddress, family: BlockListFamily }, returns: b.bool, length: 1 },
    rules: { ...js, getter: b.jsArray },
  },
  static: {
    isBlockList: { args: { value: b.opaque }, returns: b.bool },
  },
});
