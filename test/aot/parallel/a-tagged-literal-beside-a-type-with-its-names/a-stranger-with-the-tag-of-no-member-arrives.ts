type Step = { kind: 0; source: number } | { kind: 1; at: number };
function pick(s: Step): unknown { return s.kind === 0 ? s.source : s.kind === 1 ? s.at : "neither"; }
const loose: any[] = JSON.parse('[{"kind":0,"source":3},{"kind":1,"at":4},{"kind":2},{"source":5},7,null]');
const own: Step[] = [{ kind: 0, source: 1 }, { kind: 1, at: 2 }];
let out: unknown[] = [];
for (const s of own) out.push(pick(s));
for (const s of loose) { try { out.push(pick(s)); } catch (e) { out.push((e as Error).constructor.name); } }
console.log(out.join());
