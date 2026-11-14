// A method that reads a table by a key it is handed, and steps what it finds, is copied into loops that call it with a written text. What the copy finds under the key, what is thrown in its turns, and the
// order of cleanups must be what a call gives.
let log = "";
function stepped<T>(name: string, values: T[]): Iterable<T> {
  return {
    [Symbol.iterator]() {
      let at = 0;
      return {
        next() { return at < values.length ? { done: false, value: values[at++]! } : { done: true, value: undefined as never }; },
        return() { log += "<" + name + ">"; return { done: true, value: undefined as never }; },
      };
    },
  };
}
type Table = Record<string, Iterable<(value: number) => void>>;
class Board {
  sum = 0;
  constructor(public table: Table) {}
  tell(name: string, value: number): void { for (const listener of this.table[name]!) listener(value); }
  first(name: string, value: number): number { for (const listener of this.table[name]!) { listener(value); return value; } return -1; }
}
function tried(run: () => unknown): string {
  log = "";
  try { return String(run()) + " " + log; } catch (error) { return (error as Error).name + ":" + (error as Error).message + " " + log; }
}
function plain(board: Board, turns: number): number { for (let i = 0; i < turns; i++) { board.tell("a", i); board.tell("b", i * 2); } return board.sum; }
function missing(board: Board, turns: number): number { for (let i = 0; i < turns; i++) { board.tell("a", i); board.tell("nowhere", i); } return board.sum; }
function caught(board: Board, turns: number): string {
  let out = "";
  for (let i = 0; i < turns; i++) { try { board.tell("throws", i); out += "."; } catch (error) { out += "!" + (error as Error).message; } finally { out += ";"; } }
  return out + board.sum;
}
function underAForOf(board: Board, values: Iterable<number>): number { for (const value of values) { board.tell("a", value); board.tell("throws", value); } return board.sum; }
function leavesEarly(board: Board, turns: number): number { let got = 0; for (let i = 0; i < turns; i++) got += board.first("own", i) + board.first("empty", i); return got; }
function oddNames(board: Board, turns: number): string {
  let out = "";
  for (let i = 0; i < turns; i++) { for (const run of [() => board.tell("__proto__", i), () => board.tell("0", i), () => board.tell("length", i), () => board.tell("constructor", i), () => board.tell("", i)]) out += tried(run).slice(0, 9) + "|"; }
  return out;
}
function direct(board: Board, turns: number): string {
  let out = "";
  for (let i = 0; i < turns; i++) {
    try { board.tell("__proto__", i); out += "p"; } catch (error) { out += (error as Error).name[0]; }
    try { board.tell("0", i); out += "0"; } catch (error) { out += (error as Error).name[0]; }
    try { board.tell("got", i); out += "g"; } catch (error) { out += (error as Error).name[0]; }
  }
  return out + board.sum;
}
function changes(board: Board, turns: number): number {
  for (let i = 0; i < turns; i++) { board.tell("a", 1); if (i === 1) board.table = { a: [value => { board.sum += value * 100; }] }; if (i === 3) board.table.a = new Set([value => { board.sum += value * 1000; }]); }
  return board.sum;
}
function make(): Board {
  const board: Board = new Board({
    a: new Set([value => { board.sum += value; }, value => { board.sum += 1; }]),
    b: [value => { board.sum -= value; }],
    throws: stepped("throws", [value => { board.sum += 1; }, value => { if (value & 1) throw new RangeError("odd " + value); }, value => { board.sum += 10; }]),
    own: stepped("own", [value => { board.sum += value; }]),
    empty: stepped("empty", []),
    0: [value => { board.sum += 5; }],
  });
  return board;
}
for (let round = 0; round < 3; round++) {
  console.log(tried(() => plain(make(), 5)), "|", tried(() => missing(make(), 5)), "|", tried(() => caught(make(), 4)));
  console.log(tried(() => underAForOf(make(), stepped("outer", [2, 4, 5, 6]))), "|", tried(() => underAForOf(make(), [2, 4])), "|", tried(() => leavesEarly(make(), 3)));
  console.log(tried(() => oddNames(make(), 1)), "|", tried(() => changes(make(), 6)));
  const withGetter = make();
  let reads = 0;
  Object.defineProperty(withGetter.table, "got", { get() { reads++; return reads & 1 ? [(value: number) => { withGetter.sum += 7; }] : undefined; } });
  console.log(tried(() => direct(withGetter, 3)), reads);
  const inherits = make();
  inherits.table = Object.create({ a: [(value: number) => { inherits.sum += 3; }], b: new Set() }) as Table;
  console.log(tried(() => plain(inherits, 4)));
  const behindAProxy = make();
  let asked = "";
  behindAProxy.table = new Proxy(behindAProxy.table, { get(target, key, receiver) { asked += String(key) + ","; return Reflect.get(target, key, receiver); } });
  console.log(tried(() => plain(behindAProxy, 2)), asked);
  console.log(tried(() => plain({ table: { a: "xy", b: [] }, sum: 0, tell: Board.prototype.tell } as unknown as Board, 1)), "|", tried(() => plain(Object.assign(make(), { table: null }) as unknown as Board, 1)));
}
export {};
