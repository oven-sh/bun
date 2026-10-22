// Closures that are lent: typed find. It prints what plain Bun prints.
type D = { kind: number };
type S = { declarations?: D[]; signatures: readonly D[] };
const made: S[] = [];
for (let i = 0; i < 8; i++) made.push({ declarations: [{ kind: i }, { kind: 3 }, { kind: 4 }], signatures: [{ kind: i }, { kind: 9 }] });
function findIt(r: S): number { const d = r.declarations?.find(d => d.kind === 3 || d.kind === 4); if (d === undefined) return -1; return d.kind; }
function someIt(r: S): number { if (r.signatures.some(d => d.kind === 3 && d.kind > 1)) return 1; return 0; }
function filterIt(r: S): number { return r.signatures.filter(d => d.kind > 2).length; }
function mapIt(r: S): number { return r.signatures.map(d => d.kind + 2).length; }
let total = 0;
for (let i = 0; i < 4000; i++) total += findIt(made[i & 7]) + someIt(made[i & 7]) + filterIt(made[i & 7]) + mapIt(made[i & 7]);
console.log(total);
