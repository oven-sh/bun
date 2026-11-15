interface Edge { source: number; target: number }
type Step = { kind: 0; source: number; target: number } | { kind: 1; at: number };
function span(e: Edge): number { return e.target - e.source; }
function often(e: Edge): number { let s = 0; for (let i = 0; i < 4; i++) s += span(e) + e.source; return s; }
function length(s: Step): number { return s.kind === 0 ? span(s) : s.at; }
const steps: Step[] = [{ kind: 0, source: 1, target: 5 }, { kind: 1, at: 7 }];
const first = steps[0];
console.log(length(steps[0]), length(steps[1]), first.kind === 0 ? often(first) : -1, often({ source: 3, target: 4 }), Object.keys(first).join());
