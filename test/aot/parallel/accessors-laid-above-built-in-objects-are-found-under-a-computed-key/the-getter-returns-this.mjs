const unseen = (x) => [x][JSON.parse("0")];
function makeList(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return [n, n + 1]; }
function peek(list, key) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return list[key]; }
function first(list) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return list[0]; }
Object.defineProperty(Array.prototype, "self", { get() { return this; }, configurable: true });
const key = unseen("self");
let kind = "";
for (let i = 0; i < 300; i++) { const list = makeList(i); peek(list, key)[0] = "text"; kind = typeof first(list); }
console.log(kind);
