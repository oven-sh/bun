// A member that nobody has read, or that holds undefined or null, is deleted, redefined with other attributes, made an accessor, or given a value of another kind.
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

const loose = (kit: Kit) => kit as unknown as Record<string, unknown>;
for (let n = 0; n < 4; n++) {
  const deleted = kit("deleted" + n, n);
  say("delete", n, delete loose(deleted).first, delete loose(deleted).maybe, delete loose(deleted).none, "first" in deleted, "maybe" in deleted, "none" in deleted, deleted.own(), Object.keys(deleted).join("+"));
  loose(deleted).first = () => 2;
  loose(deleted).maybe = undefined;
  say("back", n, deleted.first(), String(deleted.maybe), Object.keys(deleted).join("+"));

  const hidden = kit("hidden" + n, n);
  for (const name of ["first", "own", "maybe", "none"]) Object.defineProperty(hidden, name, { enumerable: false });
  say("hidden", n, Object.keys(hidden).join("+"), hidden.first(), hidden.own(), String(hidden.maybe && hidden.maybe()), String(hidden.none && hidden.none()), hidden.own === hidden.own);

  const locked = kit("locked" + n, n);
  for (const name of ["first", "maybe", "none"]) Object.defineProperty(locked, name, { writable: false });
  say("locked", n, attempt(() => (locked.first = () => 3)), attempt(() => (locked.maybe = undefined)), attempt(() => (locked.none = null)), show(locked));

  const accessors = kit("accessors" + n, n);
  const before = n & 1 ? accessors.own : undefined;
  Object.defineProperty(accessors, "own", { get: () => () => "from a getter", configurable: true, enumerable: true });
  Object.defineProperty(accessors, "none", { get: () => null, configurable: true, enumerable: true });
  say("accessors", n, accessors.own(), String(accessors.none), before ? before() : "-", Object.keys(accessors).join("+"));

  const numbers = kit("numbers" + n, n);
  for (const name of ["first", "own", "maybe", "none"]) loose(numbers)[name] = n + name.length;
  say("numbers", n, JSON.stringify(numbers));
  for (const name of ["first", "own"]) loose(numbers)[name] = () => name;
  loose(numbers).maybe = undefined;
  loose(numbers).none = null;
  say("functions again", n, show(numbers));

  const described = kit("described" + n, n);
  const descriptors = Object.getOwnPropertyDescriptors(described);
  say("described", n, descriptors.first.value === described.first, descriptors.own.value === described.own, String(descriptors.maybe.value === described.maybe), String(descriptors.none.value === described.none), Object.values(descriptors).map(d => "" + d.writable + d.enumerable + d.configurable).join());
}

console.log(lines.join("\n"));
