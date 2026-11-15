interface Tagged { kind: number; source: number }
type Step = { kind: 0; source: number; target: number } | { kind: 1; source: number };
function tag(t: Tagged): number { return t.kind * 10 + t.source; }
function pick(s: Step): number { return s.kind === 0 ? s.target : s.source; }
const steps: Step[] = [{ kind: 0, source: 1, target: 5 }, { kind: 1, source: 7 }];
let sum = 0; for (let i = 0; i < 6; i++) sum += tag(steps[i % 2]) + pick(steps[i % 2]);
console.log(sum, tag({ kind: 4, source: 2 }));
