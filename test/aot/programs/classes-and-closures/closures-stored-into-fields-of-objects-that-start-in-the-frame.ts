// An object that need not outlive its function is made with unread members and members that hold undefined or null; on some paths it leaves the function after all.
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

const escaped: Kit[] = [];
function local(i: number): string {
  const one = kit("local" + i, i);
  if (i % 7 === 0) escaped.push(one);
  return i % 3 === 0 ? one.own() : i % 3 === 1 ? String(one.first()) : String(one.maybe ? one.maybe() : one.none);
}
function takesFunction(i: number): () => string {
  const one = kit("taken" + i, i);
  return i % 2 ? one.own : () => one.own() + " indirectly";
}
function compares(i: number): boolean {
  const one = kit("compared" + i, i);
  const other = { ...one };
  return one.own === other.own && one.first === other.first && one.maybe === other.maybe && one.none === other.none && other.own() === "compared" + i + " owns";
}
const results: string[] = [];
let same = 0;
for (let i = 0; i < 42; i++) {
  results.push(local(i));
  if (compares(i)) same++;
}
say(results.join());
say("escaped", escaped.map(show).join(" ; "));
say("taken", [0, 1, 2, 3].map(i => takesFunction(i)()).join(), "same", same);

console.log(lines.join("\n"));
