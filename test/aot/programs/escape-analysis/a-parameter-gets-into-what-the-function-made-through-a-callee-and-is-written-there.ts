// A caller makes an object, reads it, hands it to a function and reads it again. The function makes an object, a scope, a list or a map of its own; a callee, a getter, a trap or a conversion puts
// the parameter there, or keeps it elsewhere; another callee then writes to the parameter through it. Each callee calls itself, so that it is not taken into its caller.
// The second read sees the write. The output is that of plain Bun.
type Cell = { n: number };
type Box = { held: Cell | undefined };
const lines: string[] = [];

function putInBox(box: Box, cell: Cell, depth: number): void {
  if (depth > 0) return putInBox(box, cell, depth - 1);
  box.held = cell;
}
function bumpInBox(box: Box, depth: number): void {
  if (depth > 0) return bumpInBox(box, depth - 1);
  if (box.held) box.held.n += 1;
}
function throughBox(cell: Cell, depth: number): void {
  if (depth > 0) return throughBox(cell, depth - 1);
  const box: Box = { held: undefined };
  putInBox(box, cell, 1);
  bumpInBox(box, 1);
}

function throughScope(cell: Cell, depth: number): number {
  if (depth > 0) return throughScope(cell, depth - 1);
  let held: Cell | undefined;
  let turns = 0;
  function put(given: Cell, again: number): void {
    if (again > 0) return put(given, again - 1);
    held = given;
  }
  function bump(again: number): void {
    if (again > 0) return bump(again - 1);
    held!.n += 1;
    turns++;
  }
  put(cell, 1);
  bump(1);
  bump(1);
  return turns;
}

function putInList(list: Cell[], cell: Cell, depth: number): void {
  if (depth > 0) return putInList(list, cell, depth - 1);
  list.push(cell);
}
function bumpInList(list: Cell[], depth: number): void {
  if (depth > 0) return bumpInList(list, depth - 1);
  list[0].n += 1;
}
function throughList(cell: Cell, depth: number): number {
  if (depth > 0) return throughList(cell, depth - 1);
  const list: Cell[] = [];
  putInList(list, cell, 1);
  bumpInList(list, 1);
  return list.length;
}

function putInMap(map: Map<string, Cell>, cell: Cell, depth: number): void {
  if (depth > 0) return putInMap(map, cell, depth - 1);
  map.set("k", cell);
}
function bumpInMap(map: Map<string, Cell>, depth: number): void {
  if (depth > 0) return bumpInMap(map, depth - 1);
  map.get("k")!.n += 1;
}
function makeClosure(cell: Cell, depth: number): () => void {
  if (depth > 0) return makeClosure(cell, depth - 1);
  return () => {
    cell.n += 10;
  };
}
function runClosure(closure: () => void, depth: number): void {
  if (depth > 0) return runClosure(closure, depth - 1);
  closure();
}
function throughMapAndClosure(cell: Cell, depth: number): number {
  if (depth > 0) return throughMapAndClosure(cell, depth - 1);
  const map = new Map<string, Cell>();
  putInMap(map, cell, 1);
  bumpInMap(map, 1);
  runClosure(makeClosure(cell, 1), 1);
  return map.size;
}

const ways: ((box: Box, cell: Cell) => void)[] = [
  (box, cell) => {
    box.held = cell;
  },
  (box, cell) => {
    box.held = { n: cell.n };
  },
];
function throughTable(cell: Cell, way: number, depth: number): number {
  if (depth > 0) return throughTable(cell, way, depth - 1);
  const box: Box = { held: undefined };
  ways[way](box, cell);
  bumpInBox(box, 1);
  return box.held!.n;
}

let keptList: string[] | undefined;
class ListWithGetter extends Array<string> {
  get 5(): string {
    keptList = this;
    return "got";
  }
}
function throughSlowRead(source: string[], texts: readonly string[]): string {
  let result = "";
  for (const text of texts) add(text);
  return result;

  function add(text: string) {
    result += source[5] + text + ";";
    if (keptList) keptList[0] = "changed" + result.length;
  }
}

let store: ((list: number[]) => void) | undefined;
function throughGetterIntoScope(list: number[], depth: number): number {
  if (depth > 0) return throughGetterIntoScope(list, depth - 1);
  let held: number[] | undefined;
  let sum = 0;
  store = given => {
    held = given;
  };
  function read(from: number[], again: number): void {
    if (again > 0) return read(from, again - 1);
    sum += from[7] ?? 1;
  }
  function write(again: number): void {
    if (again > 0) return write(again - 1);
    if (held) held[0] += 100;
  }
  read(list, 1);
  write(1);
  store = undefined;
  return sum;
}

let openBox: Box | undefined;
function throughConversion(cell: Cell, depth: number): number {
  if (depth > 0) return throughConversion(cell, depth - 1);
  const box: Box = { held: undefined };
  openBox = box;
  const sum = +cell;
  bumpInBox(box, 1);
  openBox = undefined;
  return sum;
}

function nest(outer: (() => void) | undefined, depth: number): number {
  let n = 0;
  const increase = () => {
    n += 1;
  };
  const call = (given: () => void, again: number): void => {
    if (again > 0) return call(given, again - 1);
    given();
    increase();
  };
  if (outer) call(outer, 1);
  if (depth > 0) {
    const before = n;
    const inner = nest(increase, depth - 1);
    return before * 100 + n * 10 + inner;
  }
  return n;
}

function cellThrough(round: number, run: (cell: Cell) => unknown): string {
  const cell: Cell = { n: round };
  const before = cell.n;
  const answer = run(cell);
  return before + ">" + cell.n + " " + answer;
}

for (let round = 0; round < 4; round++) {
  {
    const cell: Cell = { n: round };
    const before = cell.n;
    throughBox(cell, 1);
    lines.push("box " + before + ">" + cell.n);
  }
  {
    const cell: Cell = { n: round };
    const before = cell.n;
    const turns = throughScope(cell, 1);
    lines.push("scope " + before + ">" + cell.n + " " + turns);
  }
  {
    const cell: Cell = { n: round };
    const before = cell.n;
    const length = throughList(cell, 1);
    lines.push("list " + before + ">" + cell.n + " " + length);
  }
  {
    const cell: Cell = { n: round };
    const before = cell.n;
    const size = throughMapAndClosure(cell, 1);
    lines.push("map and closure " + before + ">" + cell.n + " " + size);
  }
  {
    const cell: Cell = { n: round };
    const before = cell.n;
    const held = throughTable(cell, round % 2, 1);
    lines.push("table " + before + ">" + cell.n + " " + held);
  }
  {
    const list: string[] = round % 2 ? new ListWithGetter() : [];
    list.push("first" + round);
    const before = list[0];
    const result = throughSlowRead(list, ["p", "q"]);
    keptList = undefined;
    lines.push("slow read " + before + ">" + list[0] + " " + list.length + " " + result);
  }
  {
    const list = [round];
    if (round % 2) {
      Object.defineProperty(list, 7, {
        get() {
          store?.(this as number[]);
          return 7;
        },
        configurable: true,
      });
    }
    const before = list[0];
    const sum = throughGetterIntoScope(list, 1);
    lines.push("getter into scope " + before + ">" + list[0] + " " + sum);
  }
  {
    const cell = {
      n: round,
      valueOf() {
        if (round % 2) openBox!.held = this;
        return 5;
      },
    };
    const before = cell.n;
    const sum = throughConversion(cell, 1);
    lines.push("conversion " + before + ">" + cell.n + " " + sum);
  }
  lines.push("nested " + nest(undefined, round), "by a callback " + cellThrough(round, cell => throughList(cell, 2)));
}
console.log(lines.join("\n"));
