// fuzz/literals-with-the-same-keys-and-values-of-other-kinds.ts: object literals in many places of one program that have the same keys and values of other kinds in each place:
// numbers, texts, `undefined`, fields that are missing, lists, other literals. Each is handed to `JSON.stringify`, `Object.keys`, a spread and twenty more, and what they answer is printed.
import { generate } from "../literals-with-the-same-keys-and-values-of-other-kinds";
import { Random } from "../random";
import { endless } from "../family";

export default endless("literals with the same keys and values of other kinds", index => ({
  name: `seed ${index + 1}.`,
  make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
}));
