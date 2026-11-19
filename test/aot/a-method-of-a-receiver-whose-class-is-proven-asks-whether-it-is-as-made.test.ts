// A call of a built-in's method on a receiver that is proven a Map, a Set or a list goes to a stub that no longer tests the cell and its type. What it still asks is
// whether the object is as its class made it. Each case takes that away from an object in another way, at another moment, and gives it back where that can be done.
import { buildBothWays } from "./build-both-ways";

const tables = `const seen: unknown[] = [];
function read(from: Map<string, number>, key: string): void { try { const found = from.get(key); seen.push(found); } catch (error) { seen.push((error as Error).constructor.name); } }
function ask(from: Map<string, number>, key: string): void { try { const found = from.has(key); seen.push(found); } catch (error) { seen.push((error as Error).constructor.name); } }
function write(into: Map<string, number>, key: string, value: number): void { try { into.set(key, value); seen.push("written"); } catch (error) { seen.push((error as Error).constructor.name); } }
const say = (): void => { console.log(seen.join(" ")); seen.length = 0; };
`;

buildBothWays("compile/aot/a method of a receiver whose class is proven asks whether it is as made", {
  "the prototype is another object, the class's again, none": {
    alone: true,
    files: {
      "main.ts": `${tables}
const shelf = new Map<string, number>([["a", 1]]);
read(shelf, "a"); ask(shelf, "a"); write(shelf, "b", 2); say();
const between = Object.create(Map.prototype);
between.get = function (key: string) { return "between " + key; };
between.has = function () { return "between"; };
between.set = function () { seen.push("between set"); };
Object.setPrototypeOf(shelf, between);
read(shelf, "a"); ask(shelf, "a"); write(shelf, "c", 3); say();
Object.setPrototypeOf(shelf, Map.prototype);
read(shelf, "a"); ask(shelf, "c"); write(shelf, "c", 3); ask(shelf, "c"); say();
Object.setPrototypeOf(shelf, null);
read(shelf, "a"); ask(shelf, "a"); write(shelf, "d", 4); say();
`,
    },
    prints:
      "1 true written\nbetween a between between set written\n1 false written true\nTypeError TypeError TypeError\n",
  },
  "an accessor and a value of its own hide the methods": {
    alone: true,
    files: {
      "main.ts": `${tables}
const shelf = new Map<string, number>([["a", 1]]);
read(shelf, "a"); ask(shelf, "a"); say();
Object.defineProperty(shelf, "get", { configurable: true, get() { seen.push("getter of get"); return () => "own"; } });
Object.defineProperty(shelf, "has", { configurable: true, value: () => "own has" });
read(shelf, "a"); ask(shelf, "a"); say();
delete (shelf as any).get; delete (shelf as any).has;
read(shelf, "a"); ask(shelf, "a"); say();
Object.freeze(shelf);
read(shelf, "a"); write(shelf, "z", 26); ask(shelf, "z"); say();
`,
    },
    prints: "1 true\ngetter of get own own has\n1 true\n1 written true\n",
  },
  "an operand changes the receiver between the read of the method and the call": {
    alone: true,
    files: {
      "main.ts": `const shelf = new Map<string, number>([["k1", 10], ["k2", 20], ["k3", 30], ["k4", 40]]);
let turns = 0;
const names = {
  get label(): string {
    turns++;
    if (turns === 2) (shelf as any).get = () => 1000;
    if (turns === 4) { delete (shelf as any).get; Object.setPrototypeOf(shelf, { get() { return 5000; } }); }
    return "k" + turns;
  },
};
function sum(from: Map<string, number>, source: { label: string }, times: number): number {
  let total = 0;
  for (let turn = 0; turn < times; turn++) total += from.get(source.label) ?? -1;
  return total;
}
console.log(sum(shelf, names, 2), sum(shelf, names, 1), sum(shelf, names, 1), sum(shelf, names, 1));
`,
    },
    prints: "30 1000 1000 5000\n",
  },
  "an await stands between the read of the method and the call": {
    alone: true,
    files: {
      "main.ts": `const shelf = new Map<string, number>([["k1", 1], ["k2", 2], ["k3", 3], ["k4", 4]]);
let turns = 0;
async function label(): Promise<string> {
  turns++;
  await null;
  if (turns === 2) (shelf as any).get = () => 100;
  if (turns === 3) Bun.gc(true);
  if (turns === 4) { delete (shelf as any).get; Object.setPrototypeOf(shelf, { get() { return 1000; } }); }
  return "k" + turns;
}
async function sum(from: Map<string, number>, times: number): Promise<number> {
  let total = 0;
  for (let turn = 0; turn < times; turn++) total += from.get(await label()) ?? -1;
  return total;
}
console.log(await sum(shelf, 2), await sum(shelf, 1), await sum(shelf, 1), await sum(shelf, 1));
`,
    },
    prints: "3 100 100 1000\n",
  },
  "a callback changes the list between the read of push and the call": {
    alone: true,
    files: {
      "main.ts": `const said: unknown[] = [];
function gather(into: number[], times: number, make: (turn: number) => number): void {
  for (let turn = 0; turn < times; turn++) {
    try { const length = into.push(make(turn)); said.push(length); } catch (error) { said.push((error as Error).constructor.name); }
  }
}
const say = (list: number[]): void => { console.log(said.join(" "), "|", Array.prototype.join.call(list, "+")); said.length = 0; };
const hidden: number[] = []; gather(hidden, 4, turn => { if (turn === 1) (hidden as any).push = () => "own"; return turn; }); say(hidden);
const relinked: number[] = []; gather(relinked, 4, turn => { if (turn === 1) Object.setPrototypeOf(relinked, { push() { return "relinked"; } }); return turn; }); say(relinked);
const frozen: number[] = []; gather(frozen, 4, turn => { if (turn === 1) Object.freeze(frozen); return turn; }); say(frozen);
const grown: number[] = []; gather(grown, 3, turn => { grown.push(100 + turn); return turn; }); say(grown);
`,
    },
    prints:
      "1 2 own own | 0+1\n1 2 relinked relinked | 0+1\n1 TypeError TypeError TypeError | 0\n2 4 6 | 100+0+101+1+102+2\n",
  },
  "lists and sets": {
    alone: true,
    files: {
      "main.ts": `const seen: unknown[] = [];
function add(to: number[], value: number): void { try { const length = to.push(value); seen.push(length); } catch (error) { seen.push((error as Error).constructor.name); } }
function take(from: number[]): void { try { const last = from.pop(); seen.push(last); } catch (error) { seen.push((error as Error).constructor.name); } }
function mark(inside: Set<string>, name: string): void { const had = inside.has(name); inside.add(name); seen.push(had); }
function drop(inside: Set<string>, name: string): void { const did = inside.delete(name); seen.push(did); }
const say = (): void => { console.log(seen.join(" ")); seen.length = 0; };
const both = (list: number[]): void => { add(list, 4); take(list); say(); };
const relinked = [1, 2, 3]; both(relinked); Object.setPrototypeOf(relinked, { push() { return "relinked push"; }, pop() { return "relinked pop"; } }); both(relinked);
const hidden = [1, 2, 3]; both(hidden); (hidden as any).push = () => "own push"; (hidden as any).pop = () => "own pop"; both(hidden);
const frozen = [1, 2, 3]; both(frozen); Object.freeze(frozen); both(frozen);
const marks = new Set<string>();
mark(marks, "a"); mark(marks, "a"); drop(marks, "a"); drop(marks, "a"); say();
(marks as any).has = () => "own has"; (marks as any).delete = () => "own delete";
mark(marks, "b"); drop(marks, "b"); say();
delete (marks as any).has; delete (marks as any).delete;
Object.setPrototypeOf(marks, { has() { return "relinked has"; }, add() { seen.push("relinked add"); }, delete() { return "relinked delete"; } });
mark(marks, "c"); drop(marks, "c"); say();
`,
    },
    prints:
      "4 4\nrelinked push relinked pop\n4 4\nown push own pop\n4 4\nTypeError TypeError\n" +
      "false true true false\nown has own delete\nrelinked add relinked has relinked delete\n",
  },
});
