// The inspector shows a function member under its name whether the function object exists yet or not, and undefined and null as they are.
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

import { inspect } from "node:util";
for (let n = 0; n < 4; n++) {
  say("bun", n, Bun.inspect(kit("bun" + n, n)).replace(/\s+/g, " "));
  say("node", n, inspect(kit("node" + n, n), { breakLength: Infinity }));
  say("nested", n, Bun.inspect({ list: [kit("nested" + n, n)] }).replace(/\s+/g, " "));
  const named = kit("named" + n, n);
  say("names", n, named.first.name, named.own.name, named.maybe?.name, named.none?.name, named.first.length, String(named.first), typeof named.own.call);
}

console.log(lines.join("\n"));
