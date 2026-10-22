// Outside loops, in code that is not hot, equal calls of a function of the global object and equal reads of the size of a Map or a Set go through one shared body, as calls of methods do. In a loop they stay in line. An access to a private name stays in line everywhere: its function knows what `this` is, a shared body does not.
// IR-UNTIL OutlineColdOperations
// IR= 0 toNumber CallBuiltin - \(v[0-9]+\) overload=Number/
// IR= 0 toNumberAgain CallBuiltin - \(v[0-9]+\) overload=Number/
// IR= 0 toText CallBuiltin - \(v[0-9]+\) overload=String/
// IR= 0 toTextAgain CallBuiltin - \(v[0-9]+\) overload=String/
// IR= 0 entries CallBuiltin v[0-9]+ \(\) overload=MapPrototypeSize/
// IR= 0 entriesPlusOne CallBuiltin v[0-9]+ \(\) overload=MapPrototypeSize/
// IR= 0 members CallBuiltin v[0-9]+ \(\) overload=SetPrototypeSize/
// IR= 1 sumOfSizes CallBuiltin v[0-9]+ \(\) overload=MapPrototypeSize/
export function toNumber(value: unknown): number {
  return Number(value) * 2;
}
export function toNumberAgain(value: unknown): number {
  return Number(value) * 3;
}
export function toText(value: unknown): number {
  return String(value).length;
}
export function toTextAgain(value: unknown): number {
  return String(value).length + 1;
}
export function entries(map: Map<string, number>): number {
  return map.size;
}
export function entriesPlusOne(map: Map<string, number>): number {
  return map.size + 1;
}
export function members(set: Set<string>): number {
  return set.size;
}
export function membersPlusOne(set: Set<string>): number {
  return set.size + 1;
}
export function sumOfSizes(maps: Map<string, number>[]): number {
  let sum = 0;
  for (let i = 0; i < maps.length; i++) sum += maps[i].size;
  return sum;
}

export class Counter {
  #count = 0;
  #step: number;
  constructor(step: number) {
    this.#step = step;
  }
  advance(): number {
    this.#count = this.#count + this.#step;
    return this.#count;
  }
  retreat(): number {
    this.#count = this.#count - this.#step;
    return this.#count;
  }
  static read(counter: Counter): number {
    return counter.#count;
  }
  static has(value: object): boolean {
    return #count in value;
  }
}

const f: any = { toNumber, toNumberAgain, toText, toTextAgain, entries, entriesPlusOne, members, membersPlusOne, sumOfSizes };
const valueOf = { valueOf() { return 7; }, toString() { return "seven"; } };
for (const value of ["12", " 3.5 ", "x", "", null, undefined, true, 4, 2n, valueOf, [5], [1, 2]]) console.log(f.toNumber(value), f.toNumberAgain(value), f.toText(value), f.toTextAgain(value));
for (const call of [() => f.toNumber(Symbol("s")), () => f.toNumberAgain(Symbol("s")), () => f.toText(Symbol("s")), () => f.toTextAgain(Symbol("s")), () => f.toText(Object.create(null)), () => f.toTextAgain(Object.create(null))]) {
  try {
    console.log(call());
  } catch (error) {
    console.log((error as Error).name);
  }
}
const map = new Map([["a", 1], ["b", 2]]);
const set = new Set(["a"]);
console.log(f.entries(map), f.entriesPlusOne(map), f.members(set), f.membersPlusOne(set), f.sumOfSizes([map, map, new Map()]));
class Wide extends Map<string, number> {
  get size(): number {
    return 100;
  }
}
console.log(f.entries(new Wide()), f.entriesPlusOne(new Wide()));
const counter: any = new Counter(3);
console.log(counter.advance(), counter.advance(), counter.retreat(), Counter.read(counter), Counter.has(counter), Counter.has({}));
try {
  (Counter as any).read({});
} catch (error) {
  console.log((error as Error).name);
}
try {
  counter.advance.call({});
} catch (error) {
  console.log((error as Error).name);
}
