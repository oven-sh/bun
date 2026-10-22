// Objects are frozen, sealed and made inextensible while their members are unread or hold undefined or null.
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
  const frozen = Object.freeze(kit("frozen" + n, n)) as Kit;
  say("frozen", n, Object.isFrozen(frozen), attempt(() => (frozen.first = () => 2)), attempt(() => (frozen.maybe = undefined)), attempt(() => (frozen.none = null)), attempt(() => delete (frozen as Partial<Kit>).own), frozen.own === frozen.own, show(frozen));
  const sealed = Object.seal(kit("sealed" + n, n));
  sealed.first = () => 5;
  sealed.maybe = n & 1 ? undefined : () => "sealed maybe";
  sealed.none = n & 2 ? null : () => "sealed none";
  say("sealed", n, Object.isSealed(sealed), Object.isFrozen(sealed), attempt(() => delete (sealed as Partial<Kit>).own), show(sealed));
  const closed = Object.preventExtensions(kit("closed" + n, n));
  say("closed", n, Object.isExtensible(closed), attempt(() => ((closed as unknown as Record<string, unknown>).more = 1)), delete (closed as Partial<Kit>).maybe, attempt(() => (closed.maybe = undefined)), Object.keys(closed).join("+"), closed.own());
  const copy = { ...frozen };
  copy.label = "copy of frozen";
  say("copy", n, Object.isFrozen(copy), copy.own === frozen.own, copy.own(), show(copy));
}

console.log(lines.join("\n"));
