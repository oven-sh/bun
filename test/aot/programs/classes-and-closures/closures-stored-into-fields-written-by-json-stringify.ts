// JSON.stringify leaves out function members whether the function objects exist yet or not, leaves out undefined, writes null, and calls a toJSON that nobody has read.
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

interface Written extends Kit {
  toJSON?: () => unknown;
}
function written(label: string, n: number): Written {
  const made: Written = kit(label, n);
  if (n & 4) made.toJSON = () => ({ written: made.label, first: typeof made.first });
  return made;
}
for (let n = 0; n < 8; n++) {
  const one = written("one" + n, n);
  say("one", n, JSON.stringify(one), JSON.stringify([one, written("two" + n, n)]), JSON.stringify({ inner: one }, null, 1).replace(/\n */g, ""));
  say("replacer", n, JSON.stringify(written("r" + n, n & 3), (key, value) => (typeof value === "function" ? "function " + key : value === undefined ? "undefined " + key : value)));
  say("names", n, JSON.stringify(written("names" + n, n & 3), ["label", "first", "none"]));
}
const many: Kit[] = [];
for (let i = 0; i < 40; i++) many.push(kit("m" + i, i));
const text = JSON.stringify(many);
say("many", text.length, text.slice(0, 90), many.every(one => one.own() === one.label + " owns"));

console.log(lines.join("\n"));
