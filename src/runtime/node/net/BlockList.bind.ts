import * as b from "../../../codegen/bindgen-lib.ts";
import * as table from "../../../codegen/builtins/lib.ts";

const js = { capability: "js", throws: true } as const;

/** `net.BlockList`. A structured clone shares the struct. */
export const BlockList = b.class({
  rustPath: "crate::node::net::block_list::BlockList",
  refCounted: true,
  estimatedSize: true,
  types: [table.exactType("$Node.BlockList"), table.exactType("$Bindgen.BlockList")],
  construct: {},
  proto: {
    addAddress: { ...js, args: { address: b.any, family: b.any }, length: 1 },
    addRange: { ...js, args: { start: b.any, end: b.any, family: b.any }, length: 2 },
    addSubnet: { ...js, args: { network: b.any, prefix: b.any, family: b.any }, length: 2 },
    check: { ...js, args: { address: b.any, family: b.any }, returns: b.bool, length: 1 },
    rules: { ...js, getter: b.any.returning("Array") },
  },
  static: {
    isBlockList: { args: { value: b.any }, returns: b.bool },
  },
});
