// Deep equality compares function members by identity, whether the function objects exist yet or not, and tells undefined from null and from a missing member.
const lines: string[] = [];
function say(...values: unknown[]) {
  lines.push(values.map(String).join(" "));
}
function attempt(action: () => unknown) {
  try {
    return String(action());
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

interface Kit {
  label: string;
  first: () => number;
  own: () => string;
  maybe: (() => string) | undefined;
  none: (() => string) | null;
}
// n & 1: `maybe` is a function, else undefined. n & 2: `none` is a function, else null.
function kit(label: string, n: number): Kit {
  const made = {
    label,
    first: () => 1,
    maybe: n & 1 ? () => "maybe" : undefined,
    none: n & 2 ? () => "none" : null,
  } as Kit;
  made.own = () => made.label + " owns";
  return made;
}
function show(kit: Kit) {
  return [kit.label, kit.first(), kit.own(), kit.maybe === undefined ? "undefined" : kit.maybe(), kit.none === null ? "null" : kit.none(), Object.keys(kit).join("+")].join(" | ");
}

import { isDeepStrictEqual } from "node:util";
for (let n = 0; n < 4; n++) {
  const a = kit("same", n);
  const b = kit("same", n);
  const copy = { ...a };
  say("equal", n, Bun.deepEquals(a, a), Bun.deepEquals(a, copy), Bun.deepEquals(a, b), isDeepStrictEqual(a, copy), isDeepStrictEqual(a, b));
}
interface Optional {
  label: string;
  maybe?: (() => string) | undefined;
  none?: (() => string) | null;
}
const forms: Optional[] = [{ label: "x" }, { label: "x", maybe: undefined }, { label: "x", none: null }, { label: "x", maybe: undefined, none: null }, { label: "x", maybe: () => "m", none: null }];
for (const left of forms) say("forms", forms.map(right => "" + +Bun.deepEquals(left, right) + +Bun.deepEquals(left, right, true) + +isDeepStrictEqual(left, right)).join());

console.log(lines.join("\n"));
