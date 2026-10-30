// A rest pattern and a copy of data properties hold the very function objects of the source, unread or not, and its undefined and null.
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

function withoutLabel(source: Kit) {
  const { label, ...rest } = source;
  return { label, rest };
}
function withoutFunctions(source: Kit) {
  const { first, own, ...rest } = source;
  return { first, own, rest };
}
function byComputedName(source: Kit, name: keyof Kit) {
  const { [name]: taken, ...rest } = source;
  return { taken, rest };
}
for (let n = 0; n < 4; n++) {
  const source = kit("source" + n, n);
  const a = withoutLabel(source);
  say("without label", n, a.label, a.rest.first === source.first, a.rest.own === source.own, a.rest.maybe === source.maybe, a.rest.none === source.none, a.rest.own(), Object.keys(a.rest).join("+"));
  const other = kit("other" + n, n);
  const b = withoutFunctions(other);
  say("without functions", n, b.first === other.first, b.own === other.own, b.own(), String(b.rest.maybe === other.maybe), String(b.rest.none === other.none), Object.keys(b.rest).join("+"));
  const third = kit("third" + n, n);
  const c = byComputedName(third, (["own", "maybe", "none", "first"] as const)[n]);
  say("computed", n, c.taken === third[(["own", "maybe", "none", "first"] as const)[n]], Object.keys(c.rest).join("+"), (c.rest as Partial<Kit>).first === (n === 3 ? undefined : third.first));
  const [head, ...tail] = [kit("head" + n, n), kit("tail" + n, n)];
  say("arrays", n, show(head), show(tail[0]));
}

console.log(lines.join("\n"));
