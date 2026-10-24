// Object.values, Object.entries, for-in, Reflect.ownKeys and the descriptors give the very function objects that a later read of the member gives, and undefined and null as they are.
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

for (let n = 0; n < 4; n++) {
  const a = kit("a" + n, n);
  const values = Object.values(a);
  say("values", n, values.length, values[1] === a.first, values[4] === a.own, String(values[2] === a.maybe), String(values[3] === a.none), values.map(value => typeof value).join());
  const b = kit("b" + n, n);
  const entries = Object.entries(b);
  say("entries", n, entries.map(([key, value]) => key + ":" + (value === (b as unknown as Record<string, unknown>)[key])).join(), entries.map(([, value]) => (typeof value === "function" ? value.name : String(value))).join());
  const c = kit("c" + n, n);
  const seen: string[] = [];
  for (const key in c) seen.push(key + ":" + typeof c[key as keyof Kit]);
  say("for in", n, seen.join());
  const d = kit("d" + n, n);
  say("own keys", n, Reflect.ownKeys(d).join("+"), Object.getOwnPropertyNames(d).join("+"), Object.hasOwn(d, "first"), Object.hasOwn(d, "maybe"), Object.hasOwn(d, "none"), "own" in d, d.propertyIsEnumerable("maybe"));
  const e = kit("e" + n, n);
  const rebuilt = Object.fromEntries(Object.entries(e)) as unknown as Kit;
  say("rebuilt", n, rebuilt.own === e.own, rebuilt.first === e.first, show(rebuilt));
}
let same = 0;
for (let i = 0; i < 60; i++) {
  const one = kit("k" + i, i);
  const [, first, maybe, none, own] = Object.values(one);
  if (first === one.first && maybe === one.maybe && none === one.none && own === one.own) same++;
}
say("many", same);

console.log(lines.join("\n"));
