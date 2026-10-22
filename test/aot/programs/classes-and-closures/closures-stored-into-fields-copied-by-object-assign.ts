// Object.assign gives its target the very function objects of its source, unread or not, and overwrites functions with the undefined and null of its source.
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
  const source = kit("source" + n, n);
  const target = kit("target" + n, 3 - n);
  const ownOfTarget = n & 1 ? target.own : undefined;
  const result = Object.assign(target, source);
  say("over", n, result === target, target.own === source.own, target.own !== ownOfTarget, target.maybe === source.maybe, target.none === source.none, show(target));
  const untyped: Record<string, unknown> = { before: true };
  Object.assign(untyped, source, { after: true });
  say("untyped", n, untyped.first === source.first, untyped.own === source.own, String(untyped.maybe === source.maybe), String(untyped.none === source.none), Object.keys(untyped).join("+"));
  const back = Object.assign(kit("back" + n, n), { maybe: undefined, none: null });
  say("nothing over", n, show(back));
  const filled = Object.assign(kit("filled" + n, 0), { maybe: () => "given maybe", none: () => "given none" });
  say("functions over", n, show(filled));
}
let same = 0;
for (let i = 0; i < 60; i++) {
  const source = kit("s" + i, i);
  const target = Object.assign(kit("t" + i, i >> 2), source);
  if (target.first === source.first && target.own === source.own && target.maybe === source.maybe && target.none === source.none && target.own() === "s" + i + " owns") same++;
}
say("many", same);

console.log(lines.join("\n"));
