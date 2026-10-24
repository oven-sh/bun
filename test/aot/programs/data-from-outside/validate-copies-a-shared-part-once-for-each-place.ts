// validate<T> copies an object or array that the value holds at several places once for each place, whichever code takes the value: plain data, objects of the program, or the result of another validation; types that are validated by compiled code and types that the library validates. The result is a tree, and validating it again gives an equal one. What T does not describe stays the value's own object at every place.
import { validate } from "bun:bundle";

type Leaf = { n: number };
type Pair = { left: Leaf; right: Leaf };
type Forked = { left: Forked | null; right: Forked | null };
type Lists = { left: Leaf[]; right: Leaf[] };
type Named = { left: Record<string, Leaf>; right: Record<string, Leaf> };
type Tagged = { kind: "a"; left: Tagged | null; right: Tagged | null } | { kind: "b"; left: Tagged | null; right: Tagged | null };
type Untagged = { left: Untagged | null; right: Untagged | null; k: number } | { left: Untagged | null; right: Untagged | null; k: string };
type Loose = { left: unknown; right: any };

const kinds: [string, (value: unknown) => { left: unknown; right: unknown }, (part: any) => any, () => any][] = [
  ["two members of one record type", value => validate<Pair>(value), part => ({ left: part, right: part }), () => ({ n: 1 })],
  ["a type that contains itself or null", value => validate<Forked>(value), part => ({ left: part, right: part }), () => ({ left: null, right: null })],
  ["arrays", value => validate<Lists>(value), part => ({ left: part, right: part }), () => [{ n: 1 }, { n: 2 }]],
  ["dictionaries", value => validate<Named>(value), part => ({ left: part, right: part }), () => ({ x: { n: 1 } })],
  ["a union told apart by a tag", value => validate<Tagged>(value), part => ({ kind: "a", left: part, right: part }), () => ({ kind: "b", left: null, right: null })],
  ["a union that is tried arm by arm", value => validate<Untagged>(value), part => ({ left: part, right: part, k: "s" }), () => ({ left: null, right: null, k: "s" })],
];

function plainData(whole: (part: any) => any, part: () => any): any {
  const parsed = JSON.parse(JSON.stringify(whole(null)));
  parsed.left = parsed.right = JSON.parse(JSON.stringify(part()));
  return parsed;
}
function ofTheProgram(whole: (part: any) => any, part: () => any): any {
  return whole(part());
}

for (const [label, check, whole, part] of kinds) {
  for (const [source, make] of [["plain data", plainData], ["objects of the program", ofTheProgram]] as const) {
    const value = make(whole, part);
    const first = check(value);
    const second = check(first);
    console.log(
      label + ", " + source + ":",
      value.left === value.right ? "shared in the value," : "NOT SHARED IN THE VALUE,",
      first.left === first.right ? "SHARED IN THE RESULT," : "copied twice,",
      first.left === value.left || first.right === value.left ? "THE VALUE'S OWN OBJECT," : "no object of the value,",
      second.left === second.right || second.left === first.left ? "SHARED WHEN VALIDATED AGAIN," : "copied twice again,",
      JSON.stringify(first) === JSON.stringify(value) && JSON.stringify(second) === JSON.stringify(value) ? "equal" : "NOT EQUAL",
    );
  }
}

const held = { n: 1 };
const loose = validate<Loose>({ left: held, right: held, more: held }) as Loose & { more: unknown };
console.log("what the type does not describe:", loose.left === held, loose.right === held, loose.more === held);
