// Walks over built ins, one probe of many. It prints what plain Bun prints.
function f57() { return 'ok 57'; }
for (const [key, value] of Object.entries({ f57 })) exports[key] = value;
console.log(typeof exports.f57, Object.keys(exports).join());
const out = {};
for (const [key, value] of Object.entries({ f57, n: 1 })) out[key] = value;
console.log(typeof out.f57, out.n, JSON.stringify(Object.entries({ a: 1, b: "x" })), JSON.stringify(Object.values({ a: 1, b: "x" })));
