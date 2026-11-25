const unseen = (x) => [x][JSON.parse("0")];
function item(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return { n, m: work }; }
function makeList(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return [item(n), item(n + 1)]; }
function peek(list, key) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return list[key]; }
function firstN(list) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return list[0].n; }
Object.defineProperty(Array.prototype, "extra", { get() { this[0] = 7; return 1; }, configurable: true });
const key = unseen("extra");
let out = "";
for (let i = 0; i < 300; i++) { const list = makeList(i); peek(list, key); out = String(firstN(list)); }
console.log(out);
