import { $ } from "bun";
import util from "node:util";

let foo = "hi";
console.log(util.inspect(foo));

// await $`ls fljsdklfjslkdfj`.quiet();

// Options:
// 1. make it so that VirtualMachine.printErrorInstance (javascript.zig) knows how to check if an error instance is a ShellError (right now it skips custom inspect)
// 2. make the shell error not actually an Error but just an obejct

// try {
//   await $`ls fljsdklfjslkdfj`.throws(true).quiet();
// } catch (e) {
//   // e[Bun.inspect.custom] = () => "LOL";
//   console.log(e);
//   console.log(Object.getOwnPropertyNames(e.stdout));
// }

await $`ls fljsdklfjslkdfj`.throws(true).quiet();
