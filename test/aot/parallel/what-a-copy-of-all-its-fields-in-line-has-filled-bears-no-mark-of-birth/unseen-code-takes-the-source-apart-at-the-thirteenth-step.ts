// COUNT: operation:operationAOTCopyDataProperties <= 2
type S = { tick: number; a: number; b: string; c: number[]; d: { at: number }; e?: number; f: boolean };
function line(o: S): string { return o.tick + " " + o.a + " " + o.b + " " + o.c.length + ":" + o.c[o.c.length - 1] + " " + o.d.at + " " + (o.e === undefined ? "none" : o.e) + " " + o.f; }
function say(o: S): string { try { return line(o); } catch (error) { return (error as Error).constructor.name; } }
function first(seed: number): S { return { tick: 0, a: seed, b: "b" + seed, c: [seed], d: { at: seed }, e: seed + 0.5, f: seed % 2 === 0 }; }
function step(o: S, t: number): S { return { ...o, a: o.a + 1, tick: t, b: o.b.length > 6 ? 'b' : o.b + '!' }; }
const undo: (o: any) => void = new Function('o', 'delete o.c; delete o.d;') as any;
function turn(o: S, r: number): S { if (r === 12) undo(o); return step(o, r); }
const rounds: number = JSON.parse("40");
const out: string[] = [];
let state: S = first(1);
for (let r = 0; r < rounds; r++) { state = turn(state, r); if (r % 5 === 0 || (r > 10 && r < 17)) out.push(r + " " + say(state)); }
Bun.gc(true); for (let filler = 0; filler < 2000; filler++) (globalThis as any).lastFiller = { at: "filler" + filler, more: [filler] }; Bun.gc(true);
out.push("later " + say(state));
console.log(out.join("\n"));
