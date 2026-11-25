const unseen = (x: unknown): any => [x][JSON.parse("0")];
const kit = { round: Math.floor };
unseen(kit);
const tables: Record<string, number>[] = [{ a: 1, b: 2 }, { c: 3, d: 4, e: 5 }];
const shaped = [{ a: 1, b: 2 }, { a: 3, b: 4 }];
const links = ["https://one.example/first?x=1", "https://two.example:8080/second/third?y=2#z"];
const texts = ["left,right", "up,down,over"];
const digits = ["ab12cd", "x345y"];
const lists = [[1, 2, 3], [4, 5, 6, 7]];
const maps = [new Map<string, number>(), new Map<string, number>()];
maps[0].set("k", 1); maps[0].set("l", 2); maps[1].set("m", 3);
class Point { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } }
function range(n: number) { return { low: n - 1, high: n + 1 }; }
function pair(n: number): [number, number] { return [n - 1, n + 1]; }
function sumOf(...all: number[]): number { return all.length * 100 + all[0] + all[all.length - 1]; }
function counted(this: unknown): number { return arguments.length; }
type Walk = Generator<number, number, number | undefined>;
function* walkOf(limit: number): Walk { let sum = 0; for (let i = 0; i < limit; i++) sum += (yield i * 10) ?? 0; return sum; }
function* countTo(n: number): Generator<number, void, unknown> { for (let i = 0; i < n; i++) yield i * 2; }
function take(at: number, walk: Walk, tools: { round: (x: number) => number }): string {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let out = "";
  const sent = (tools.round(at + 0.5));
  const step = walk.next(sent);
  out += step.value + ":" + step.done;
  return out + work;
}
let last = "";
for (let round = 0; round < 300; round++) {
  const line: string[] = [];
  const walk = walkOf(4);
  for (let at = 1; at < 6; at++) line.push(take(at, walk, kit));
  last = line.join(" ");
}
console.log(last);
