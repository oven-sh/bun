// Code that knows nothing of the type reads, calls, tests and stores the members by name, before anything has read them.
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

const names = ["first", "own", "maybe", "none", "label", "missing"];
function readByName(object: any, name: string) {
  return object[name];
}
function callByName(object: any, name: string) {
  return object[name]();
}
function readFirst(object: any) {
  return object.first;
}
function callOwn(object: any) {
  return object.own();
}
function callMaybe(object: any) {
  return object.maybe?.();
}
function storeByName(object: any, name: string, value: unknown) {
  object[name] = value;
}
for (let round = 0; round < 30; round++) {
  const n = round & 3;
  const a = kit("a" + round, n);
  const called = [callOwn(a), callMaybe(a), attempt(() => callByName(a, "none")), attempt(() => callByName(a, "first")), attempt(() => callByName(a, "missing"))].join();
  const b = kit("b" + round, n);
  const read = names.map(name => typeof readByName(b, name)).join();
  const identity = [readFirst(b) === b.first, readByName(b, "own") === b.own, readByName(b, "maybe") === b.maybe, readByName(b, "none") === b.none].join();
  const c = kit("c" + round, n);
  const present = names.map(name => +(name in c) + "" + +Object.hasOwn(c, name)).join();
  const d = kit("d" + round, n);
  storeByName(d, "first", n & 1 ? () => 9 : d.first);
  storeByName(d, "maybe", n & 1 ? undefined : () => "stored maybe");
  storeByName(d, "none", n & 2 ? null : () => "stored none");
  if (round < 4 || round > 27) say(round, called, read, identity, present, show(d));
}

console.log(lines.join("\n"));
