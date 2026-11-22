// Arithmetic on records that variables hold, with factors in variables: what the variables hold is asked once in front of the arithmetic.
interface Ball { x: number; y: number; vx: number; vy: number; name: string }
const trace: string[] = [];
function said(run: () => any): string {
  let answer: string;
  try { const v = run(); answer = typeof v === "object" ? "o" : Object.is(v, -0) ? "-0" : typeof v + String(v); } catch (e: any) { answer = e.name + " " + e.message; }
  return answer + (trace.length ? " " + trace.splice(0).join("") : "");
}
const lines: string[] = [];
function moves(): number { ball.x += ball.vx * step; ball.y += ball.vy * step; if (ball.x < 0 || ball.x > 100) ball.vx = -ball.vx; ball.vy += 9.8 * step; return ball.x + ball.y; }
lines.push("early " + said(moves));
let ball: Ball = { x: 10.5, y: 20.25, vx: 3.5, vy: 1.25, name: "a" };
lines.push("without a step " + said(moves), [ball.x, ball.y, ball.vx, ball.vy].join());
let step: number = JSON.parse("0.5");
function hidden(value: any): void { step = value; }
function bound(b: Ball, amount: number): () => number { return () => { b.x += b.vx * amount; b.y -= b.vy * amount; return b.x * b.y; }; }
interface World { ball: Ball; gravity: number }
function nested(w: World): number { w.ball.x += w.ball.vx * step; w.ball.y += w.ball.vy * step; w.ball.vy += w.gravity * step; return w.ball.x + w.ball.vy; }
function changed(): number { const before = ball.x * step; other(); return before + ball.x * step; }
function other(): void { trace.push("c"); ball = { x: ball.y, y: ball.x, vx: 1, vy: 2, name: "changed" }; step = step + 1; }
function each(list: Ball[], amount: number): number { let sum = 0; list.forEach(b => { b.x += b.vx * amount; sum += b.x * amount; }); return sum; }
const fields: ((b: any) => void)[] = [
  () => {}, b => { b.x = 1; }, b => { b.x = -0; }, b => { b.x = "7"; }, b => { b.vx = undefined; }, b => { b.vy = null; }, b => { b.vx = 5n; }, b => { b.x = NaN; }, b => { b.y = { valueOf() { trace.push("v"); return 2; } }; },
  b => { b.vx = { valueOf() { trace.push("s"); hidden(3); return 1.5; } }; }, b => { delete b.vx; }, b => { Object.defineProperty(b, "x", { get() { trace.push("g"); return 4; }, set() { trace.push("t"); }, configurable: true }); },
  b => { Object.freeze(b); }, b => { b.vy = Symbol("y"); }, b => { b.extra = 1; },
];
const steps: any[] = [0.5, 2, -0, 1e300, NaN, "3", undefined, null, 2n, { valueOf() { trace.push("d"); ball = made(); return 0.25; } }, true];
function made(): Ball { return JSON.parse('{"x":10.5,"y":20.25,"vx":3.5,"vy":1.25,"name":"b"}'); }
for (const change of fields) for (const amount of steps) {
  const runs: (() => any)[] = [moves, moves, bound(made(), amount), () => nested({ ball, gravity: amount }), changed, () => each([made(), ball, made()], amount), moves];
  ball = made();
  change(ball);
  hidden(amount);
  const answers = runs.map(run => said(run));
  let state = "";
  try { state = [ball.x, ball.y, ball.vx, ball.vy].map(v => typeof v + (typeof v === "symbol" ? "" : String(v))).join(); } catch (e: any) { state = e.name; }
  lines.push(answers.join("|") + " " + state + " " + typeof step);
}
console.log(lines.join("\n"));
export {};
