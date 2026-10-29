// What is spread is a text, an array or an instance of one of four other classes, under one type that only asks for an iterator.
// variant-verify-each-pass-1.test.ts always takes this program: there the IR is verified behind the pass that expands the spread.
// Flags: --aot-check=verify-each-pass
// Erased types: not built: spread-text-array-instance-other-classes is built so
type Letters = { [Symbol.iterator](): Iterator<string> };
function spreadOut(letters: Letters): string[] {
  return [...letters];
}
function* abc(): Generator<string> {
  yield "a";
  yield "b";
}
const letters: [string, () => Letters][] = [
  ["array", () => ["a", "b", "c"]],
  ["string", () => "abc"],
  ["set", () => new Set(["a", "b", "a"])],
  ["generator", abc],
  ["keys of a map", () => new Map([["k", 1]]).keys()],
  ["String object", () => new String("ab")],
];
for (const [name, make] of letters) console.log(name, spreadOut(make()).join());
