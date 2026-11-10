// `const o = { a }; if (p !== undefined) o.p = p; return o.a`: nobody reads `p` and the object never leaves: the store goes, its arm is empty, and the two tests that led to it go as well.
// STATISTIC: BranchesFoldedToJumps >= 2
// STATISTIC: DeadValueProofChecksRemoved >= 1
function first(a: number, p: number | undefined) { const o: any = { a }; if (p !== undefined) o.p = p; return o.a; }
function spread(a: number, p: number | undefined) { const o: any = { a, ...(p !== undefined ? { p } : undefined) }; return o.a; }
let s = 0, t = 0;
for (let i = 0; i < 1000; i++) { s += first(i & 7, i & 1 ? i : undefined); t += spread(i & 3, i & 1 ? i : undefined); }
console.log(s, t);
