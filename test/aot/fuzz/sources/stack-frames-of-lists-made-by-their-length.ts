// fuzz/stack-frames-of-lists-made-by-their-length.ts: lists made by their length in the ways programs write it, with fill, map and
// other methods behind them, in every kind of place. The length is one that no list has, or a later call of the chain throws or takes a stack
// trace. The stack lists Array where plain Bun calls it, and not where its bytecode makes the list in the caller. Every fourth seed is TypeScript.
import { Random } from "../random";
import { generate } from "../stack-frames-of-lists-made-by-their-length";
import { endless } from "../family";

// Every run takes these, whatever else it takes.
export default endless(
  "the stack of what a list made by its length throws lists the frames that plain Bun lists",
  index => ({
    name: `seed ${index + 1}.`,
    flags:
      index % 4 === 1 ? ["--aot-heat=everything-is-cold"] : index % 4 === 2 ? ["--aot-heat=everything-is-hot"] : [],
    make: () =>
      index % 4 === 3
        ? { file: "main.ts", text: generate(new Random(index + 1), true) }
        : { file: "main.mjs", text: generate(new Random(index + 1)) },
  }),
);
