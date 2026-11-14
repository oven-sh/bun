// answers: without-library
// # A local that is carried round a loop enters as an integer. In the plain walk a read of a view may lie outside and give undefined, so what comes round is a number and the head holds a number.
// # The typed copy holds its counter below the room of the views, so there the reads give integers. Where nothing but such reads made the number, through sums, Math.min, Math.max and joins,
// # the typed copy starts that head parameter at the integers up to 2^52: what the turn adds stays exact, and Math.min behind the sum is seen to hold it.
// # f1 = tell, f2 = show, f3 = least
// # RUN(LEAST): walk f3 mechanisms=all-Inlining
// # LEAST-LABEL: code f3:Body
// # LEAST: ({{*}}: int|whole @Double, {{*}}) frequency=Rare isLoopHead=true:
// # LEAST: ([[left]]: int[-2147483648, {{*}}] @Int64, {{*}}) isInLoop=true isLoopHead=true:
// # LEAST: = Add [[left]], {{*}} form=Integers
// # LEAST: @Int64 = CallInline {{*}} inlineBuiltin=MathMin
// # RUN(COUNT): compile AbsentElementWideningsAvoided mechanisms=all-Inlining
// # COUNT: statistic AbsentElementWideningsAvoided 1
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: exited with 0
declare function report(value: unknown): void;
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
function show(x: number, out: any): string { let text = (Object.is(x, -0) ? "-0" : String(x)) + " " + out.length + ":"; for (let i = 0; i < out.length && i < 12; i++) text += String(out[i]) + ","; return text; }
function least(prev: Uint32Array, curr: Uint32Array, first: number, count: number): number { let left = first | 0; for (let i = 1; i <= count; i++) { left = Math.min(prev[i] + 1, left + 1, prev[i - 1] + (i & 1)); curr[i] = left; } return left; }
function most(prev: Uint32Array, curr: Float64Array, first: number, count: number): number { let left = first | 0; for (let i = 1; i <= count; i++) { left = Math.max(prev[i], left * 2); curr[i] = left; } return left; }
function halves(prev: Float64Array, curr: Float64Array, first: number, count: number): number { let left = first | 0; for (let i = 1; i <= count; i++) { left = Math.min(prev[i] + 1, left + 1); curr[i] = left; } return left; }
function signs(prev: Int32Array, curr: Float64Array, first: number, count: number): number { let left = first | 0; for (let i = 1; i <= count; i++) { left = Math.min(prev[i] * left, 7); curr[i] = 1 / left; } return left; }
function wraps(prev: Uint32Array, curr: Uint32Array, first: number, count: number): number { let left = first | 0; for (let i = 1; i <= count; i++) { left = (left + prev[i]) % 1000003; curr[i] = left; } return left; }
function masks(prev: Uint32Array, curr: Uint32Array, first: number, count: number): number { let left = first | 0; for (let i = 1; i <= count; i++) { left = (left * 31 + prev[i]) & 0xffffff; curr[i] = left; } return left; }
function sums(prev: Uint32Array, curr: Float64Array, first: number, count: number): number { let left = first | 0; for (let i = 1; i <= count; i++) { left = left + prev[i] * 1048576; curr[i] = left; } return left; }
const rooms: number[] = [0, 1, 2, 7, 70];
const counts: number[] = [0, 1, 6, 7, 69, 70, 90];
const firsts: number[] = [0, 1, -1, 5, 2147483647, -2147483648];
function fill(view: any, by: number): any { for (let i = 0; i < view.length; i++) view[i] = (i * by) % 4294967295; return view; }
function each(room: number, count: number, first: number): void { tell(() => { const out = new Uint32Array(room); return show(least(fill(new Uint32Array(room), 3), out, first, count), out); }); tell(() => { const out = new Uint32Array(room); return show(least(fill(new Uint32Array(room), 4294967291), out, first, count), out); }); tell(() => { const out = new Float64Array(room); return show(most(fill(new Uint32Array(room), 5), out, first, count), out); }); tell(() => { const out = new Float64Array(room); return show(halves(fill(new Float64Array(room), 0.5), out, first, count), out); }); tell(() => { const out = new Float64Array(room); return show(signs(fill(new Int32Array(room), -1), out, first, count), out); }); tell(() => { const out = new Float64Array(room); return show(signs(new Int32Array(room), out, first, count), out); }); tell(() => { const out = new Uint32Array(room); return show(wraps(fill(new Uint32Array(room), 4294967291), out, first, count), out); }); tell(() => { const out = new Uint32Array(room); return show(masks(fill(new Uint32Array(room), 77), out, first, count), out); }); tell(() => { const out = new Float64Array(room); return show(sums(fill(new Uint32Array(room), 4294967291), out, first, count), out); }); }
for (let r = 0; r < rooms.length; r++) for (let c = 0; c < counts.length; c++) for (let f = 0; f < firsts.length; f++) each(rooms[r], counts[c], firsts[f]);
report("end");
