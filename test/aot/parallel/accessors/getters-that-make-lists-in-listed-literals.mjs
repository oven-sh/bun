// Getters that make lists and objects, where Object.values, entries, copies and rests of their literals make lists and objects too.
const out = [], held = [], other = { get a() { return 'oa'; }, b: 2 };
for (let i = 0; i < 9; i++) { const o = { a: [], get b() { return [i]; } }; Object.values(o).forEach(v => out.push(v)); }
function values(n) { for (let i = 0; i < n; i++) { const o = { a: [], get b() { return [n]; } }; Object.values(o).forEach(v => out.push(v)); } }
function counts(n) { for (let i = 0; i < n; i++) { const o = { a: [], get b() { return [n]; } }; out.push(Object.values(o).length); } }
function entries(n) { for (let i = 0; i < n; i++) { const o = { get a() { return [i]; }, get b() { return [n]; } }; for (const [k, v] of Object.entries(o)) out.push(k, v); } }
function spreads(n) { for (let i = 0; i < n; i++) { const o = { get a() { return { i }; }, get b() { return { n }; }, c: {} }; const made = { ...o }; out.push(made.a, made.b, made); } }
function rests(n) { for (let i = 0; i < n; i++) { const o = { get a() { return { i }; }, get b() { return { n }; }, c: {} }; const { c, ...rest } = o; out.push(rest.a, rest); } }
function both(n) { for (let i = 0; i < n; i++) { const o = { a: [], get b() { held.push({ ...other }); return [n]; } }; out.push({ ...o }); Object.values(o).forEach(v => out.push(v)); } }
function nested(n) { for (let i = 0; i < n; i++) { const o = { get a() { return Object.values({ get x() { return [i]; }, y: n }); }, b: [i] }; out.push(Object.values(o), Object.entries(o)); } }
function closures(n) { for (let i = 0; i < n; i++) { const o = { get a() { return () => i; }, get b() { return class { m() { return n; } }; }, get c() { return new Map([[i, n]]); } }; const [f, C, m] = Object.values(o); out.push(f(), new C().m(), m.get(i)); } }
for (const n of [1, 2, 8]) for (const f of [values, counts, entries, spreads, rests, both, nested, closures]) f(n);
console.log(out.length, held.length, JSON.stringify(out).length, JSON.stringify(out.slice(0, 60)));
