const turns = Number(process.argv[2] ?? 2);
const say = x => { try { return JSON.stringify(x, (k, v) => v === undefined ? "undefined" : typeof v === "number" && (!Number.isFinite(v) || Object.is(v, -0)) ? (Object.is(v, -0) ? "-0" : String(v)) : typeof v === "function" ? "function " + v.name : typeof v === "bigint" ? v + "n" : v); } catch (e) { return String(e); } };
const sparse = [1, , 3, , , 6]; const long = []; long[40] = 2; long.length = 45;
function kept(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 1.5).filter(() => true); return got; }
function told(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 1.5).reduce((t, v, i) => t + i + ":" + v + " ", ""); return got; }
function joined(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 1.5).join("-"); return got; }
function hasUndefined(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 1.5).includes(undefined); return got; }
function places(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 1.5).map((v, i) => i); return got; }
function keys(list) { let got; for (let turn = 0; turn < turns; turn++) got = Object.keys(list.map(x => x * 1.5).slice()).join(); return got; }
for (const list of [sparse, long, new Array(5), [, 1], [1, 2, 3]]) console.log(say(kept(list)), say(told(list)), say(joined(list)), say(hasUndefined(list)), say(places(list)), 1 in places(list), say(keys(list)));
// STATISTIC: ArraySpeciesLookupsElided >= 1
// STATISTIC: NumberStoresDispatchedByIndexingType <= 5
