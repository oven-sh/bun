const turns: number = Number(process.argv[2] ?? 2);
const say = (x: unknown): string => { try { return JSON.stringify(x, (k, v) => v === undefined ? "undefined" : typeof v === "number" && (!Number.isFinite(v) || Object.is(v, -0)) ? (Object.is(v, -0) ? "-0" : String(v)) : typeof v === "function" ? "function " + v.name : typeof v === "bigint" ? v + "n" : v); } catch (e) { return String(e); } };
type Row = { id: number; qty: number };
const rows: Row[] = JSON.parse(JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ id: i, qty: 1 + (i % 4) }))));
function total(rows: Row[]): number { let got = 0; for (let turn = 0; turn < turns; turn++) got = rows.map(row => row.qty * 2).filter(value => value > 2).reduce((sum, value) => sum + value, 0); return got; }
function halves(rows: Row[]): number[] { let got: number[] = []; for (let turn = 0; turn < turns; turn++) got = rows.map(row => row.qty / 2).filter(value => value > 0.5); return got; }
function texts(rows: Row[]): string { let got = ""; for (let turn = 0; turn < turns; turn++) got = rows.map(row => row.qty * 1.5).map(value => value.toFixed(1)).join(","); return got; }
function least(rows: Row[]): number { let got = 0; for (let turn = 0; turn < turns; turn++) got = rows.map(row => row.qty - 2.5).reduce((low, value) => Math.min(low, value), Infinity); return got; }
console.log(total(rows), say(halves(rows)), texts(rows), least(rows));
// STATISTIC: NewListsInPlaceOfSpecies >= 1
