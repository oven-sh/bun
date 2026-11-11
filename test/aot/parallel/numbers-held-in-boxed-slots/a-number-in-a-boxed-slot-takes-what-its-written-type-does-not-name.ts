// A number whose slot stays boxed is held to its written type. Code that comes by the key at run time stores under it what the type does not name,
// lays an accessor in its place, takes the field away or freezes the object: every reader finds what plain JavaScript finds.
enum Level {
  Low = 1,
  Middle = 2,
  High = 4,
}
const flags = Symbol("flags");
const level = Symbol("level");
class Holder {
  [flags]: Level = Level.High;
  [level]: Level = Level.High;
  bits: number = 4;
  has(bit: number): boolean {
    return (this[flags] & bit) !== 0;
  }
  add(bit: number): void {
    this[flags] |= bit;
  }
  isAt(asked: Level): boolean {
    return (this[level] & asked) !== 0;
  }
  thrice(): number {
    return this[level] * 3;
  }
  hasBit(bit: number): boolean {
    return (this.bits & bit) !== 0;
  }
  addBit(bit: number): void {
    this.bits |= bit;
  }
  halve(): void {
    this.bits = 0.5;
  }
}
const show = (value: unknown): string =>
  Object.is(value, -0) ? "-0" : typeof value === "bigint" ? String(value) + "n" : typeof value === "object" && value !== null ? "an object" : typeof value + " " + String(value);
const lines: string[] = [];
const heard: string[] = [];
function tell(where: string, holder: Holder) {
  const said: string[] = [];
  const say = (what: () => unknown) => {
    try {
      said.push(show(what()));
    } catch (error) {
      said.push("throws " + (error as Error).name);
    }
  };
  say(() => holder.has(4));
  say(() => holder.isAt(Level.High));
  say(() => holder.thrice());
  say(() => holder.hasBit(4));
  say(() => holder.add(2));
  say(() => holder.addBit(2));
  say(() => (holder as any)[flags]);
  say(() => (holder as any)[level]);
  say(() => (holder as any).bits);
  lines.push(where + ": " + said.join(" | ") + (heard.length ? " | heard " + heard.splice(0).join(" ") : ""));
}
function sum(holders: Holder[]): string {
  let levels = 0;
  let marked = 0;
  let bits = 0;
  for (const holder of holders) {
    levels += holder[level] * 3;
    if ((holder[flags] & 6) !== 0) marked++;
    bits |= holder.bits;
  }
  return show(levels) + " " + marked + " " + bits;
}
type Way = (holder: object, key: PropertyKey, value: unknown) => unknown;
const ways: Record<string, Way> = {
  "a store by key": (holder, key, value) => ((holder as any)[key] = value),
  "Reflect.set": (holder, key, value) => Reflect.set(holder, key, value),
  "Object.defineProperty": (holder, key, value) => Object.defineProperty(holder, key, { value, writable: true, enumerable: true, configurable: true }),
  "Object.assign": (holder, key, value) => Object.assign(holder, { [key]: value }),
  "an accessor of its own": (holder, key, value) =>
    Object.defineProperty(holder, key, { get: () => value, set: given => void heard.push("set " + show(given)), enumerable: true, configurable: true }),
  "an accessor above it": (holder, key, value) => {
    delete (holder as any)[key];
    const between = Object.create(Object.getPrototypeOf(holder), {
      [key]: { get: () => value, set: (given: unknown) => void heard.push("set above " + show(given)), configurable: true },
    });
    Object.setPrototypeOf(holder, between);
  },
  "an accessor above a field that stays": (holder, key, value) => {
    const between = Object.create(Object.getPrototypeOf(holder), {
      [key]: { get: () => value, set: (given: unknown) => void heard.push("set above " + show(given)), configurable: true },
    });
    Object.setPrototypeOf(holder, between);
  },
  "a read-only value above a field that stays": (holder, key, value) => {
    Object.setPrototypeOf(holder, Object.create(Object.getPrototypeOf(holder), { [key]: { value, writable: false } }));
  },
  "a store into a frozen object": (holder, key, value) => {
    Object.freeze(holder);
    return Reflect.set(holder, key, value);
  },
  "a store, then frozen": (holder, key, value) => {
    (holder as any)[key] = value;
    Object.freeze(holder);
  },
  "read-only": (holder, key, value) => Object.defineProperty(holder, key, { value, writable: false }),
};
const values: Record<string, () => unknown> = {
  "a text": () => "12",
  "a fraction": () => 4.5,
  "beyond 32 bits": () => 2 ** 40 + 4,
  "minus nought": () => -0,
  "no number": () => NaN,
  "an object with valueOf": () => ({ valueOf: () => 4 }),
  undefined: () => undefined,
  null: () => null,
  "a big integer": () => 4n,
  "a boolean": () => true,
  "an int32": () => 6,
};
const keysOf = (holder: object): PropertyKey[] => [...Object.getOwnPropertySymbols(holder), ...Object.keys(holder)];
for (let turn = 0; turn < 3; turn++)
  for (const [way, store] of Object.entries(ways))
    for (const [kind, make] of Object.entries(values))
      for (const at of [0, 1, 2]) {
        const holder = new Holder();
        tell("as made", holder);
        const key = keysOf(holder)[at];
        store(holder, key, make());
        tell(way + " of " + kind + " under " + String(key), holder);
      }
for (let turn = 0; turn < 3; turn++)
  for (const at of [0, 1, 2]) {
    const holder = new Holder();
    delete (holder as any)[keysOf(holder)[at]];
    tell("taken away at " + at, holder);
    tell("and laid again at " + at, holder);
  }
for (const [kind, make] of Object.entries(values))
  for (const at of [0, 1, 2]) {
    const holders = [new Holder(), new Holder(), new Holder(), new Holder()];
    lines.push("a row as made: " + sum(holders));
    (holders[2] as any)[keysOf(holders[2])[at]] = make();
    let said: string;
    try {
      said = sum(holders);
    } catch (error) {
      said = "throws " + (error as Error).name;
    }
    lines.push("a row with " + kind + " at " + at + ": " + said);
  }
const halved = new Holder();
halved.halve();
tell("halved", halved);
console.log([...new Set(lines)].join("\n"));
