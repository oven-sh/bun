const turns = Number(process.argv[2] ?? 2);
const say = x => { try { return JSON.stringify(x, (k, v) => v === undefined ? "undefined" : typeof v === "number" && (!Number.isFinite(v) || Object.is(v, -0)) ? (Object.is(v, -0) ? "-0" : String(v)) : typeof v === "function" ? "function " + v.name : typeof v === "bigint" ? v + "n" : v); } catch (e) { return String(e); } };
const source = JSON.parse("[1,2,3]"); const log = [];
Object.defineProperty(Array.prototype, "tag", { get() { log.push(this.length); return "tagged"; }, configurable: true });
function tagOfMade(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 0.5).tag; return got; }
function tagOfKept(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 0.5).filter(v => v > 0.6).tag; return got; }
function kept(list) { let got; for (let turn = 0; turn < turns; turn++) got = list.map(x => x * 0.5).filter(v => v > 0.6); return got; }
console.log(say(tagOfMade(source)), say(tagOfKept(source)), say(kept(source)), say(log));
delete Array.prototype.tag;
// STATISTIC: NewListsInPlaceOfSpecies >= 1
// STATISTIC: NumbersStoredByKindOfStorageInCopiedRuns <= 1
