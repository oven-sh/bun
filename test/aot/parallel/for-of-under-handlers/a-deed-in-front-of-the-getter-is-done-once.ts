// A deed stands in front of the read that leaves the typed turn: the turn may not begin again, and the deed is done once for each element.
const log: string[] = []; const say = (x: unknown): void => { log.push(String(x)); };
class Box { constructor(public v: number) {} }
const rows: Box[][] = [[new Box(1), new Box(2)], [new Box(3)]], one = [1, 2];
function* gen(n: number): Generator<number> { try { for (let i = 0; i < n; i++) yield i; } finally { say("f"); } }
const run = (f: () => unknown): void => { try { say(f()); } catch (e) { say(e instanceof Error ? e.message : e); } };
const bad: any = Object.defineProperty({}, "v", { get() { say("get"); return 5; } }); const mixed: any[][] = [[new Box(1), new Box(2)], [new Box(3), bad, new Box(4)], [new Box(5)]]; let seen = 0;
function deep(list: Box[][]): number { let s = 0; for (const row of list) for (const b of row) s += b.v; return s; }
function deed(list: Box[][]): number { let s = 0; for (const row of list) for (const b of row) { seen++; s += b.v; } return s; }
run(() => deed(mixed)); say(seen); // n09
console.log(log.join(" "));
export {};
