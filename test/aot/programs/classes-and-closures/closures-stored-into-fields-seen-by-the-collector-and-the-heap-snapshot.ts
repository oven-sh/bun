// Collections and a heap snapshot come while the members are unread or hold undefined or null; what is read afterwards is as if none had come.
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

const kept: Kit[] = [];
for (let i = 0; i < 400; i++) {
  kept.push(kit("k" + i, i));
  if (i % 100 === 50) Bun.gc(true);
}
Bun.gc(true);
const snapshot = Bun.generateHeapSnapshot();
say("snapshot", typeof snapshot, Array.isArray((snapshot as { nodes?: unknown }).nodes));
let right = 0;
for (let i = 0; i < kept.length; i += 2) {
  const one = kept[i];
  if (one.own() === "k" + i + " owns" && one.first() === 1 && (i & 1 ? one.maybe!() === "maybe" : one.maybe === undefined) && (i & 2 ? one.none!() === "none" : one.none === null)) right++;
}
Bun.gc(true);
const functions = kept.map(one => one.own);
Bun.gc(true);
say("read", right, functions.every((own, i) => own === kept[i].own && own() === "k" + i + " owns"), show(kept[1]), show(kept[2]));
// The only reference to an object is the closure that one of its members made.
let owners: (() => string)[] = [];
for (let i = 0; i < 200; i++) owners.push(kit("alone" + i, i).own);
Bun.gc(true);
say("alone", owners.every((own, i) => own() === "alone" + i + " owns"));
owners = [];
Bun.gc(true);

console.log(lines.join("\n"));
