// A spread into a literal of another declared type holds the very function objects of its source, unread or not, and the undefined and null of its source.
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

interface Wider extends Kit {
  extra: number;
}
interface Narrower {
  label: string;
  own: () => string;
  none: (() => string) | null;
}
function widened(source: Kit, extra: number): Wider {
  return { ...source, extra };
}
function narrowed(source: Kit): Narrower {
  return { label: source.label, own: source.own, none: source.none };
}
for (let n = 0; n < 4; n++) {
  const source = kit("source" + n, n);
  const wide = widened(source, n);
  const narrow = narrowed(source);
  say("wide", n, wide.first === source.first, wide.own === source.own, wide.maybe === source.maybe, wide.none === source.none, wide.own(), wide.extra, show(wide));
  say("narrow", n, narrow.own === source.own, narrow.none === source.none, narrow.own(), String(narrow.none && narrow.none()), Object.keys(narrow).join("+"));
}
const sources: Kit[] = [];
const copies: Wider[] = [];
for (let i = 0; i < 60; i++) {
  sources.push(kit("s" + i, i));
  copies.push(widened(sources[i], i));
}
let same = 0;
for (let i = 0; i < 60; i++) if (copies[i].first === sources[i].first && copies[i].own === sources[i].own && copies[i].maybe === sources[i].maybe && copies[i].none === sources[i].none && copies[i].own() === "s" + i + " owns") same++;
say("many", same);

console.log(lines.join("\n"));
