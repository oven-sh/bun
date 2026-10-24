// Text that is evaluated at run time reads, calls, tests and stores the members, before anything has read them.
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

const read = new Function("kit", "return [typeof kit.first, typeof kit.own, typeof kit.maybe, typeof kit.none, kit.own(), kit.first(), 'maybe' in kit, 'none' in kit, Object.keys(kit).join('+')].join()");
const take = new Function("kit", "return [kit.first, kit.own, kit.maybe, kit.none]");
const store = new Function("kit", "n", "kit.first = n & 1 ? kit.first : () => 7; kit.maybe = n & 1 ? undefined : () => 'evaluated maybe'; kit.none = n & 2 ? null : () => 'evaluated none'; return kit");
for (let round = 0; round < 24; round++) {
  const n = round & 3;
  const text = read(kit("a" + round, n));
  const b = kit("b" + round, n);
  const taken = take(b) as unknown[];
  const identity = [taken[0] === b.first, taken[1] === b.own, taken[2] === b.maybe, taken[3] === b.none].join();
  const stored = show(store(kit("c" + round, n), n) as Kit);
  if (round < 4 || round > 21) say(round, text, identity, stored);
}

console.log(lines.join("\n"));
