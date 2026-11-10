// Both loops step a list by index alone, so the inner body stands under no handler and a turn of its typed copy begins again where an element is no Box. The getter of that element runs once a turn.
// STATISTIC: TurnsThatBeginAgain >= 1
const log: string[] = []; const say = (x: unknown): void => { log.push(String(x)); };
class Box { constructor(public v: number) {} }
const rows: Box[][] = [[new Box(1), new Box(2)], [new Box(3)]], one = [1, 2];
function* gen(n: number): Generator<number> { try { for (let i = 0; i < n; i++) yield i; } finally { say("f"); } }
const run = (f: () => unknown): void => { try { say(f()); } catch (e) { say(e instanceof Error ? e.message : e); } };
const bad: any = Object.defineProperty({}, "v", { get() { say("get"); return 5; } }); const mixed: any[][] = [[new Box(1), new Box(2)], [new Box(3), bad, new Box(4)], [new Box(5)]]; let seen = 0;
function deep(list: Box[][]): number { let s = 0; for (const row of list) for (const b of row) s += b.v; return s; }
function deed(list: Box[][]): number { let s = 0; for (const row of list) for (const b of row) { seen++; s += b.v; } return s; }
for (let i = 0; i < 3; i++) run(() => deep(mixed)); // n08
console.log(log.join(" "));
export {};
