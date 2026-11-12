// COUNTER: ObjectsParsedIntoOrdinaryObjects = 0
// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate
interface Small { id: number; name: string; active: boolean }
interface Wide { a1: number; b2: string; c3: boolean; d4: number; e5: string; f6: number; g7: boolean }
const orders = <T,>(list: T[]): T[][] => list.length < 2 ? [list] : list.flatMap((each, i) => orders([...list.slice(0, i), ...list.slice(i + 1)]).map(rest => [each, ...rest]));
const small = orders(['"id":1', '"name":"ab"', '"active":true']);
const wide = orders(['"a1":1', '"b2":"two"', '"c3":true', '"d4":4.5']).map((front, i) => [...front, ...(i & 1 ? ['"g7":false', '"e5":"five"', '"f6":6'] : ['"e5":"five"', '"f6":6', '"g7":false'])]);
const tell = (label: string, rows: object[]): void => { for (const r of rows) { const met: string[] = []; for (const k in r) met.push(k); console.log(label, Object.keys(r).join(), met.join() === Object.keys(r).join(), JSON.stringify(r), JSON.stringify({ ...r })); } };
const smallRows: Small[] = JSON.parse("[" + small.flatMap(order => ["{" + order.join() + ',"zqone":1}', "{" + order.join() + ',"zqtwo":2,"zqone":[1]}']).join() + "]");
const wideRows: Wide[] = JSON.parse("[" + wide.map((order, i) => "{" + order.join() + ',"zq' + (i % 3) + '":' + i + "}").join() + "]");
let s = 0;
for (const r of smallRows) s += r.id + r.name.length + (r.active ? 1 : 0);
for (const r of wideRows) s += r.a1 + r.b2.length + (r.c3 ? 1 : 0) + r.d4 + r.e5.length + r.f6 + (r.g7 ? 1 : 0);
console.log(s);
tell("small", smallRows);
tell("wide", wideRows);
