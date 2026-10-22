// A call of a function of node:path with an operand that is no string is not made directly: the function refuses or converts the operand as in plain Bun.
import path from "node:path";
function report(name: string, probe: () => unknown) {
  let answer: unknown;
  try {
    answer = probe();
  } catch (error) {
    answer = [(error as any).name, (error as any).code, (error as Error).message];
  }
  console.log(name, JSON.stringify(answer));
}
const any = path as any;
let conversions = 0;
const text = new String("/a/b");
(text as any).toString = () => {
  conversions++;
  return "/converted";
};
for (const operand of [undefined, null, 5, true, {}, [], Symbol.iterator, 5n, () => 1]) {
  report("isAbsolute " + typeof operand, () => any.isAbsolute(operand));
  report("join " + typeof operand, () => any.join("a", operand));
  report("dirname " + typeof operand, () => any.dirname(operand));
  report("basename suffix " + typeof operand, () => any.basename("a.txt", operand));
}
report("no operand", () => [any.join(), any.resolve().length > 0]);
report("isAbsolute without operand", () => any.isAbsolute());
report("a String object", () => [any.dirname(text), any.join(text, "c"), conversions]);
report("more operands than declared", () => [any.isAbsolute("/a", 5), any.dirname("/a/b", {})]);
function maybe(index: number): string | undefined {
  return ["/a/b", undefined][index];
}
report("an operand that may be missing", () => [0, 1].map(index => path.dirname(maybe(index) as string)));
