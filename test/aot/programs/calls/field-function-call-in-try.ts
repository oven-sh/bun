// `object?.field(..)` where the field holds a function: the object is passed as `this`. By its type the object may be absent, it has been
// tested, and in some of the calls a handler watches.
// VALIDATED compiles
const lines: string[] = [];
function say(...parts: unknown[]) {
  lines.push(parts.map(part => (typeof part === "object" && part !== null ? JSON.stringify(part) : String(part))).join(" "));
}
interface Namer {
  prefix: string;
  name: (x: number) => string;
  weigh: (x: number) => number;
}
const names: ((this: Namer, x: number) => string)[] = [
  function (x) {
    return this.prefix + x;
  },
  function (x) {
    if (x > 2) throw new RangeError("too large: " + x);
    return x + this.prefix;
  },
  function (x) {
    return this.prefix.repeat(x);
  },
];
const weights: ((this: Namer, x: number) => number)[] = [
  function (x) {
    return x + this.prefix.length + 0.5;
  },
  function (x) {
    if (x > 2) throw new RangeError("too heavy: " + x);
    return x - 0.5;
  },
  function (x) {
    return x * 1.5;
  },
];
function makeNamer(prefix: string, kind: number): Namer {
  return { prefix, name: names[kind], weigh: weights[kind] };
}
function nameGuarded(namer: Namer | undefined, x: number): string | undefined {
  let name: string | undefined;
  try {
    name = namer?.name(x);
  } catch (error) {
    name = (error as Error).message;
  }
  return name;
}
function nameTwiceGuarded(namers: (Namer | undefined)[], at: number, x: number): string {
  const namer = namers[at];
  let name = "";
  try {
    name += namer?.name(x);
    name += namer?.name(x + 1);
  } catch {
    name += "?";
  } finally {
    name += ".";
  }
  return name;
}
function nameUnguarded(namer: Namer | undefined, x: number): string | undefined {
  return namer?.name(x & 1);
}
function nameOrNothing(namer: Namer | undefined, x: number): string {
  const name = namer?.name(x & 1);
  return name === undefined ? "nothing" : name + "!";
}
function nameOfBoth(first: Namer | undefined, second: Namer | undefined, x: number): string {
  return String(first?.name(x & 1)) + String(second?.name(x & 1));
}
function weighGuarded(namer: Namer | undefined, x: number): number {
  let weight: number | undefined;
  try {
    weight = namer?.weigh(x);
  } catch {
    weight = -1;
  }
  return weight === undefined ? -2 : weight * 2;
}
const namers = [makeNamer("a", 0), undefined, makeNamer("b", 1), makeNamer("c", 2)];
for (let x = 0; x < 5; x++) {
  say(namers.map(namer => nameGuarded(namer, x)), namers.map((_, at) => nameTwiceGuarded(namers, at, x)), namers.map(namer => weighGuarded(namer, x)));
  say(namers.map(namer => nameUnguarded(namer, x)), namers.map(namer => nameOrNothing(namer, x)), nameOfBoth(namers[x & 3], namers[(x + 1) & 3], x));
}
let total = 0;
for (let i = 0; i < 20000; i++) total += (nameGuarded(namers[i & 3], i % 5) ?? "").length + nameTwiceGuarded(namers, i & 3, i % 5).length + weighGuarded(namers[i & 3], i % 5) + nameOrNothing(namers[i & 3], i).length;
say(total);
console.log(lines.join("\n"));
