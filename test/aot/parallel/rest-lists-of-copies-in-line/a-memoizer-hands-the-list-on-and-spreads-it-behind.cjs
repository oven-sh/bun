// A memoizer: the rest list is handed to the function that makes the key, and spread into the call behind it: by the text the list cannot fall away.
// The maker of keys is JSON.stringify unless one is given, and here one is always given: the copy in line guesses the built-in, fails, and leaves for the call.
// The list that the copy has made stays needed on the arm of the built-in: the arm that leaves hands that one on and makes no second.
// STATISTIC: RestListsMadeWhereTheyLeave = 0
const rows = JSON.parse('[{"id":1,"qty":2},{"id":2,"qty":3},{"id":1,"qty":2},{"id":5,"qty":0}]');
const memoize = (fn, keyOf = JSON.stringify) => { const cache = new Map(); return (...args) => { const key = keyOf(args); if (cache.has(key)) return cache.get(key); const v = fn(...args); cache.set(key, v); return v; }; };
let calls = 0;
const cost = memoize((a, b) => { calls++; return a * b + a % (b + 1); }, args => args[0] * 64 + args[1]);
const byId = memoize(r => { calls++; return r.id * 2; }, args => args[0].id);
const byText = memoize((a, b) => { calls++; return a + "/" + b; });
function run(turn) { let sum = turn; for (const r of rows) sum += cost(r.id, r.qty) + byId(r); return sum + ":" + calls + ":" + byText(turn, "x"); }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
