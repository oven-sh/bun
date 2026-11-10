const turns = Number(process.argv[2] ?? 2);
const say = x => { try { return JSON.stringify(x, (k, v) => v === undefined ? "undefined" : typeof v === "number" && (!Number.isFinite(v) || Object.is(v, -0)) ? (Object.is(v, -0) ? "-0" : String(v)) : typeof v === "function" ? "function " + v.name : typeof v === "bigint" ? v + "n" : v); } catch (e) { return String(e); } };
function halves(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 0.5).filter(v => v % 1 === 0.5); return got; }
function sum(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x + 0.25).reduce((t, v) => t + v, 0); return got; }
function odd(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x | 0).filter(v => v & 1); return got; }
for (const n of [0, 1, 7, 8, 9, 1000, 99999, 100000, 100001, 250000]) { const list = Array.from({ length: n }, (_, i) => i); const got = halves(list); console.log(n, got.length, got[0], got[got.length - 1], sum(list), odd(list).length); }
// STATISTIC: NewListsInPlaceOfSpecies >= 1
