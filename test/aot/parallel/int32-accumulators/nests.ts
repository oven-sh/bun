// Loops inside loops over a parameter's list: elements that are added to properties, passed to callees that a flag chooses, said by loggers that are on and off, and three iterations in a hot loop.
// STATISTIC: LoopsUnswitched >= 9
const parse = (text: string): number[] => JSON.parse(text);
const lists: [string, number[]][] = [["ints", parse("[" + Array.from({ length: 16 }, (_, k) => (k * 37) % 101).join() + "]")], ["doubles", parse("[" + Array.from({ length: 16 }, (_, k) => ((k * 37) % 101) / 4).join() + "]")], ["odd", parse('[1,2,"3",4,null,6,7,8]')], ["few", parse("[3,1,2]")], ["none", []], ["large", parse("[2147483647,2147483647,-2147483648,1,-0,5]")]];
const holes = parse("[1,2,3,4,5,6,7,8]"); delete holes[4]; lists.push(["holes", holes]);
const o: any = { total: 0, seen: 0 }; let sink: any = 0, calls = 0; let on = process.argv.length > 9; const said: any[] = []; let turn: (() => void) | null = null;
function say(x: unknown) { said.push(x); calls++; if (turn && calls > 5) { const t = turn; turn = null; t(); } }
function debug(x: unknown) { if (!on) return; say(x); }
const tell: any = process.argv.length > 9 ? console.log : (x: any) => { sink = x; };
const twice = (x: number) => x * 2, next = (x: number) => x + 1; const go = process.argv.length > 9 ? twice : next;
function add(list: number[], n: number) { let s = 0; for (let r = 0; r < n; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; o.total = (o.total + x) | 0; s = (s + x) | 0; } return s + "," + o.total; }
function less(list: number[], n: number) { for (let r = 0; r < n; r++) for (let i = 0; i < list.length; i++) o.seen -= list[i]!; return o.seen; }
function masked(list: number[], n: number) { for (let r = 0; r < n; r++) for (let i = 0; i < list.length; i++) o.total = (o.total + list[i]!) & 1023; return o.total; }
function log(list: number[], n: number) { let s = 0; for (let r = 0; r < n; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; debug(x); s = (s + x) | 0; } return s; }
function told(list: number[], n: number) { let s = 0; for (let r = 0; r < n; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; if (on) tell(x); s = (s + x) | 0; } return s + "," + sink; }
function chosen(list: number[], n: number) { let s = 0; for (let r = 0; r < n; r++) for (let i = 0; i < list.length; i++) s = (s + go(list[i]!)) | 0; return s; }
function three(list: number[], n: number) { let s = 0; for (let r = 0; r < n * 4; r++) for (let i = 0; i < 3; i++) { const x = list[i]!; debug(x); s = (s + x) | 0; } return s; }
function threeTold(list: number[], n: number) { let s = 0; for (let r = 0; r < n * 4; r++) for (let i = 0; i < 3; i++) { const x = list[i]!; if (on) tell(x); s = (s + x) | 0; } return s + "," + sink; }
function kept(list: number[], n: number) { for (let r = 0; r < n; r++) for (let i = 0; i < list.length; i++) sink = list[i]; return sink; }
function counted(list: number[], n: number) { const counts = [0, 0, 0, 0]; for (let r = 0; r < n; r++) for (let i = 0; i < list.length; i++) counts[list[i]! & 3]!++; return counts.join(); }
for (const [name, list] of lists) for (const f of [add, less, masked, log, told, chosen, three, threeTold, kept, counted]) for (const way of ["off", "on", "turned off", "throws"]) {
  o.total = o.seen = sink = calls = 0; said.length = 0; on = way !== "off";
  turn = way === "turned off" ? () => { on = false; } : way === "throws" ? () => { throw new Error("told"); } : null;
  let r: unknown; try { r = f(list, 3); } catch (e: any) { r = "threw " + e.message; }
  console.log(name, f.name, way, String(r), calls, String(said.slice(-3)));
}
