import * as b from "../../../codegen/bindgen-lib.ts";
import * as table from "../../../codegen/builtins/lib.ts";
import { SocketAddress } from "../../socket/SocketAddress.bind.ts";

const js = { capability: "js", throws: true } as const;

/** `other` is an address string. */
export const BlockListAddress = b.union({ address: SocketAddress, other: b.opaque });

/** `net.BlockList`. A structured clone shares the struct. */
export const BlockList = b.class({
  rustPath: "crate::node::net::block_list::BlockList",
  refCounted: true,
  estimatedSize: true,
  types: [table.exactType("$Node.BlockList"), table.exactType("$Bindgen.BlockList")],
  construct: {},
  proto: {
    addAddress: { ...js, args: { address: BlockListAddress, family: b.opaque }, length: 1 },
    addRange: {
      ...js,
      args: { start: BlockListAddress.withValue, end: BlockListAddress, family: b.opaque },
      length: 2,
    },
    addSubnet: { ...js, args: { network: BlockListAddress, prefix: b.opaque, family: b.opaque }, length: 2 },
    check: { ...js, args: { address: BlockListAddress, family: b.opaque }, returns: b.bool, length: 1 },
    rules: { ...js, getter: b.jsArray },
  },
  static: {
    isBlockList: { args: { value: b.self.otherAsNull }, returns: b.bool, length: 1 },
  },
});
