function f(data, t) { let s = t & 1; for (let i = 0; i < data.rows.length; i++) s = s + data.rows[i]; return s; }
const rounds = +process.argv[2] || 3;
class Rows extends Array { get length() { return 2; } }
class Plain extends Array {}
const named = [3, 1, 4]; named.extra = 7; named["-1"] = 9;
const all = [Rows.from([3, 1, 4]), Plain.from([3, 1, 4]), named, Object.setPrototypeOf([3, , 4], { __proto__: Array.prototype, 1: 50 }), Object.seal([3, 1, 4]), Object.preventExtensions([0.5, 1.5])];
for (let r = 0; r < rounds; r++) for (const rows of all) console.log(String(f({ rows }, r)));
