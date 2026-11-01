// The parts of these types are types that looking at them makes, level after level, without end. `bun check` finds no error: nobody asks for the parts.
// The compiler asked, to see whether a member's type means the same in every file, and went on until the memory was gone.
type Endless<T> = T extends unknown ? [Endless<[T]>] : never;
type EndlessList<T> = T extends unknown ? EndlessList<T[]>[] : never;
type EndlessMap<T> = T extends unknown ? Map<string, EndlessMap<[T]>> : never;
interface Holder {
  tuple: Endless<1>;
  list?: EndlessList<"a">;
  map?: EndlessMap<true>;
  count: number;
}
const first: Holder = JSON.parse('{ "tuple": [[[[]]]], "list": [[[]]], "count": 2 }');
function depthOf(value: unknown): number {
  return Array.isArray(value) ? 1 + Math.max(0, ...value.map(depthOf)) : 0;
}
console.log(first === null ? 0 : 1, first.count + 1, depthOf(first.tuple), depthOf(first.list), first.map === undefined);
console.log(first.tuple[0][0].length, first.list?.[0]?.[0]?.length);
