// A record is spread into a literal of another type, or taken apart by a rest pattern: whichever members the source has, in whichever order it got them, whatever the target holds already.
// Each form runs several times over the same kinds of source, so the first copy of a kind and the copies after it are both seen.
const lines: string[] = [];
function show(label: string, value: object): void {
  lines.push(label + ": " + Object.keys(value).join(",") + " | " + JSON.stringify(value) + " | " + Reflect.ownKeys(value).length);
}

interface Options { a?: number; b?: string; c?: boolean; d?: number | string; e?: { x: number }; f?: number[]; g?: null | number; h?: undefined | string; i?: () => number; j?: bigint | number }
interface Wider extends Options { first: number; last?: string; k?: number; l?: string }
interface Numbers { a?: number; d?: number; g?: number; j?: number; k?: number }
interface Loose { a?: unknown; b?: unknown; c?: unknown; d?: unknown; e?: unknown; f?: unknown; g?: unknown; h?: unknown; i?: unknown; j?: unknown }

const inner = { x: 1 };
const list = [1, 2];
const answer = () => 42;
function make(bits: number): Options {
  const made: Options = {};
  if (bits & 1) made.a = bits;
  if (bits & 2) made.b = "b" + bits;
  if (bits & 4) made.c = (bits & 8) !== 0;
  if (bits & 8) made.d = bits & 16 ? "text" : bits + 0.5;
  if (bits & 16) made.e = inner;
  if (bits & 32) made.f = list;
  if (bits & 64) made.g = bits & 1 ? null : 7;
  if (bits & 128) made.h = bits & 2 ? undefined : "h";
  if (bits & 256) made.i = answer;
  if (bits & 512) made.j = bits & 4 ? 10 : 1.25;
  return made;
}
function makeBackwards(bits: number): Options {
  const made: Options = {};
  if (bits & 512) made.j = 3;
  if (bits & 128) made.h = "h";
  if (bits & 32) made.f = list;
  if (bits & 8) made.d = 8;
  if (bits & 2) made.b = "b";
  if (bits & 1) made.a = 1;
  return made;
}

function behindAMember(source: Options, n: number): Wider { return { first: n, ...source }; }
function inFrontOfAMember(source: Options, n: number): Wider { return { ...source, first: n }; }
function between(source: Options, n: number): Wider { return { first: n, ...source, last: "last" }; }
function overMembers(source: Options, n: number): Wider { return { a: -1, first: n, d: "before", k: 5, ...source }; }
function underMembers(source: Options, n: number): Wider { return { first: n, ...source, a: -1, d: "after" }; }
function two(one: Options, other: Options, n: number): Wider { return { first: n, ...one, ...other }; }
function intoLoose(source: Options): Loose { return { ...source }; }
function numbersInto(source: Numbers, n: number): Wider { return { first: n, ...source }; }
function withoutTwo(source: Options): Omit<Options, "a" | "e"> { const { a, e, ...rest } = source; return rest; }
function withoutOne(source: Wider): Options { const { first, ...rest } = source; return rest; }

const kinds = [0, 1, 2, 3, 5, 8, 24, 31, 64, 65, 128, 130, 256, 512, 516, 341, 682, 1023, 1022, 511];
for (let round = 0; round < 3; round++) {
  for (const bits of kinds) {
    const label = round + " " + bits + " ";
    const source = make(bits);
    show(label + "behind a member", behindAMember(source, bits));
    show(label + "in front of a member", inFrontOfAMember(source, bits));
    show(label + "between", between(source, bits));
    show(label + "over members", overMembers(source, bits));
    show(label + "under members", underMembers(source, bits));
    show(label + "two", two(source, makeBackwards(bits ^ 1023), bits));
    show(label + "two of one kind", two(source, make(bits), bits));
    show(label + "backwards", behindAMember(makeBackwards(bits), bits));
    show(label + "into loose", intoLoose(source));
    show(label + "without two", withoutTwo(source));
    show(label + "without one", withoutOne(behindAMember(source, bits)));
    show(label + "the source afterwards", source);
  }
}

const numbers: Numbers[] = [{ a: 1 }, { a: 1.5, d: 2 }, { k: 3, j: 4, g: 5 }, { d: -0, a: 2147483647, g: -2147483648 }, { a: NaN, d: Infinity }, { j: 1e21, k: 0.1 }];
for (let round = 0; round < 3; round++)
  for (const source of numbers) show(round + " numbers", numbersInto(source, round));

// What a copy holds is what the source holds, and a store to the one does not reach the other.
for (let round = 0; round < 3; round++) {
  const source = make(1023);
  const copy = behindAMember(source, round);
  lines.push(round + " the same objects: " + (copy.e === source.e) + " " + (copy.f === source.f) + " " + (copy.i === source.i) + " " + copy.i!());
  copy.a = -5; copy.b = "changed"; delete copy.c;
  source.d = "changed too"; delete source.g;
  show(round + " the copy", copy);
  show(round + " the source", source);
}

// Sources that are more than their fields.
for (let round = 0; round < 3; round++) {
  const frozen = Object.freeze(make(7));
  const sealed = Object.seal(make(7));
  const grown = make(7) as Options & Record<string, unknown>; grown.extra = round; grown["x" + round] = 1;
  const cut = make(15); delete cut.b;
  const cutAndBack = make(15); delete cut.a; cutAndBack.a = 9;
  const redefined = make(7); Object.defineProperty(redefined, "b", { enumerable: false });
  const withGetter = make(7); Object.defineProperty(withGetter, "a", { get() { return "got"; }, enumerable: true, configurable: true });
  const marked = make(7) as Options & { [key: symbol]: number }; marked[Symbol.for("mark")] = round;
  for (const [name, source] of Object.entries({ frozen, sealed, grown, cut, cutAndBack, redefined, withGetter, marked })) {
    const copy = behindAMember(source, round);
    show(round + " " + name, copy);
    copy.a = 100; copy.last = "stored";
    show(round + " " + name + ", stored to", copy);
    lines.push(round + " " + name + ": " + Object.isFrozen(copy) + " " + Object.isSealed(copy) + " " + Object.isExtensible(copy) + " " + Object.getOwnPropertySymbols(copy).length);
  }
}
console.log(lines.join("\n"));
