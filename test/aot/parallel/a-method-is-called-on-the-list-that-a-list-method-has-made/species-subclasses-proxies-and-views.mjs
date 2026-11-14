const turns = Number(process.argv[2] ?? 2);
const say = x => { try { return JSON.stringify(x, (k, v) => v === undefined ? "undefined" : typeof v === "number" && (!Number.isFinite(v) || Object.is(v, -0)) ? (Object.is(v, -0) ? "-0" : String(v)) : typeof v === "function" ? "function " + v.name : typeof v === "bigint" ? v + "n" : v); } catch (e) { return String(e); } };
class Rows extends Array {}
class Plain extends Array { static get [Symbol.species]() { return Array; } }
class Odd extends Array { static get [Symbol.species]() { return function (n) { return { length: 0, made: n, filter(f) { return "odd filter " + Object.keys(this).join(); } }; }; } }
function run(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 0.5).filter(v => v > 0.6); return got; }
const proxied = new Proxy([1, 2, 3], { get(t, k, r) { return Reflect.get(t, k, r); } });
const like = { length: 3, 0: 1, 1: 2, 2: 3, map: Array.prototype.map };
const own = [1, 2, 3]; own.constructor = { [Symbol.species]: Rows };
const noConstructor = [1, 2, 3]; noConstructor.constructor = undefined;
for (let round = 0; round < 2; round++) for (const list of [[1, 2, 3], Rows.from([1, 2, 3]), Plain.from([1, 2, 3]), Odd.from([1, 2, 3]), proxied, like, own, noConstructor, new Float64Array([1, 2, 3]), new Uint8Array([1, 2, 3]), [4, 5]]) { const got = run(list); console.log(got?.constructor?.name, say(ArrayBuffer.isView(got) ? Array.from(got) : got)); }
// STATISTIC: ArraySpeciesLookupsElided >= 1
// STATISTIC: NumberStoresDispatchedByIndexingType <= 0
