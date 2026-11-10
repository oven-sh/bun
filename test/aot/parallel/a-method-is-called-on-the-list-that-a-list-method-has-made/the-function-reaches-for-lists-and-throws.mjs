const turns = Number(process.argv[2] ?? 2);
const say = x => { try { return JSON.stringify(x, (k, v) => v === undefined ? "undefined" : typeof v === "number" && (!Number.isFinite(v) || Object.is(v, -0)) ? (Object.is(v, -0) ? "-0" : String(v)) : typeof v === "function" ? "function " + v.name : typeof v === "bigint" ? v + "n" : v); } catch (e) { return String(e); } };
const source = JSON.parse("[1,2,3,4,5,6]"); const log = [];
function grows(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map((x, i, all) => { if (i === 1 && all.length < 9) all.push(70); return x * 0.5; }).filter(v => v > 0.4); return got; }
function shrinks(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map((x, i, all) => { if (i === 1) all.length = 3; return x * 0.5; }).filter(v => v > 0.4); return got; }
function stores(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map((x, i, all) => { if (i === 2) all[4] = "late"; return x * 0.5; }).filter(v => v === v); return got; }
function viaThis(list, holder) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(function (x) { this.got.push(x); return x * 0.5; }, holder).filter(v => v > 0.4); return got; }
function viaClosure(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => { log.push(x); return x * 0.5; }).filter(v => { log.push(-v); return v > 1; }); return got; }
function fails(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => { if (x === 3) throw new RangeError("at " + x); return x * 0.5; }).filter(v => v > 0); return got; }
function failsLater(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 0.5).filter(v => { if (v === 1.5) throw new TypeError("kept " + v); return true; }); return got; }
function inner(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 0.5).filter(v => v > 0.4); return got; }
function reenters(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map((x, i) => i < 2 ? inner([9, 8]).length + x * 0.5 : x * 0.5).filter(v => v > 0.4); return got; }
for (let round = 0; round < 2; round++) { const a = source.slice(), b = source.slice(), c = source.slice(), holder = { got: [] };
  console.log(say(grows(a)), say(a), say(shrinks(b)), say(b), say(stores(c)), say(c), say(viaThis(source.slice(), holder)), say(holder.got), say(viaClosure(source.slice())), log.length, say(reenters(source.slice())));
  for (const f of [fails, failsLater]) { try { console.log(say(f(source.slice()))); } catch (e) { console.log(e.constructor.name, e.message); } } }
// STATISTIC: NewListsInPlaceOfSpecies >= 1
// STATISTIC: NumbersStoredByKindOfStorageInCopiedRuns <= 2
