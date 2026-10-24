// Built-ins make instances of a class below a built-in class by themselves: through Symbol.species, through `this` of a static method, through Reflect.construct and through structuredClone, which makes none.
const lines: string[] = [];
function attempt(read: () => unknown): string { try { return String(read()); } catch (e) { return "throws " + (e as Error).name; } }
class List extends Array<number> {
  tag: string = "list";
  sum(): number { let sum = 0; for (const each of this) sum += each; return sum; }
}
class Bytes extends Uint8Array {
  tag: string = "bytes";
  sum(): number { let sum = 0; for (const each of this) sum += each; return sum; }
}
class Later<T> extends Promise<T> {
  tag: string = "later";
  describe(): string { return this.tag; }
}
class Pattern extends RegExp {
  tag: string = "pattern";
  describe(): string { return this.tag + this.source + this.flags; }
}
class Store extends ArrayBuffer {
  tag: string = "store";
  describe(): string { return this.tag + this.byteLength; }
}
class Groups extends Map<string, number[]> {
  tag: string = "groups";
  describe(): string { return this.tag + this.size; }
}
function list(k: List): string { return k.tag + k.sum() + ":" + k.length + (k instanceof List); }
function bytes(k: Bytes): string { return k.tag + k.sum() + ":" + k.length + (k instanceof Bytes); }
function later(k: Later<number>): string { return k.describe() + (k instanceof Later); }
function pattern(k: Pattern): string { return k.describe() + (k instanceof Pattern); }
function store(k: Store): string { return k.describe() + (k instanceof Store); }
function groups(k: Groups): string { return k.describe() + (k instanceof Groups); }
const waits: Promise<unknown>[] = [];
for (let round = 0; round < 3; round++) {
  const numbers = List.from([1, 2, 3]) as List;
  lines.push(list(numbers), list(numbers.map(each => each * 2) as List), list(numbers.filter(each => each > 1) as List), list(numbers.slice(1) as List), list(List.of(4, 5) as List), list(numbers.concat([9]) as List), list(numbers.splice(0, 1) as List), attempt(() => list(numbers.flat() as List)));
  const some = Bytes.from([1, 2, 3]) as Bytes;
  lines.push(bytes(some), bytes(some.map(each => each * 2) as Bytes), bytes(some.filter(each => each > 1) as Bytes), bytes(some.slice(1) as Bytes), bytes(some.subarray(1) as Bytes), bytes(Bytes.of(7) as Bytes));
  const first = new Later<number>(resolve => resolve(1));
  lines.push(later(first), later(first.then(() => 2) as Later<number>), later(first.catch(() => 3) as Later<number>), later(first.finally(() => {}) as Later<number>), later(Later.resolve(4) as Later<number>), later(Later.all([first]) as unknown as Later<number>));
  waits.push(first, (async () => lines.push("awaited " + (await first)))());
  const words = new Pattern("a(b)?", "g");
  lines.push(pattern(words), "xabxa".split(words).join("|"), attempt(() => [..."abab".matchAll(words)].length), "abab".replace(words, "-"), pattern(words));
  const memory = new Store(8);
  lines.push(store(memory), store(memory.slice(2) as Store));
  lines.push(attempt(() => groups(Reflect.construct(Map, [], Groups) as Groups)), attempt(() => groups(Reflect.construct(Groups, [], Groups))), attempt(() => groups(structuredClone(new Groups()) as Groups)), attempt(() => groups(Map.groupBy([1, 2], each => String(each)) as Groups)));
  Bun.gc(true);
}
await Promise.all(waits);
console.log(lines.join("\n"));
export {};
