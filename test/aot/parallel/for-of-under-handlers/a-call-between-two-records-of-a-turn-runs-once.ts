// A counted loop inside a for-of reckons with the fields of two records a turn and does something between them; a record is now and then something else.
// Whatever hands out the points is closed exactly when plain Bun closes it.
const out: string[] = [], J = JSON.parse, hide = (x: any): any => [x][J("0")];
const say = (name: string, f: () => unknown): void => { try { const v = f(); out.push(name + " " + typeof v + " " + (Object.is(v, -0) ? "-0" : String(v))); } catch (e: any) { out.push(name + " threw " + (e && e.name) + " " + (e && e.message)); } };
let log: string[] = [];
const records = (): any[] => [{ x: 1.5, y: 2.5 }, { x: 4.25, y: 5.25 }, { x: 7.125, y: 8.125 }, { x: 0.5, y: 0.25 }];
const odd: Record<string, () => any> = {
  none: () => ({ x: 2.5, y: 3.5 }), whole: () => ({ x: 1, y: 2 }), turned: () => ({ y: 3.5, x: 2.5 }), more: () => ({ w: 0, x: 2.5, y: 3.5 }), texts: () => ({ x: "2.5", y: "a" }), lacks: () => ({ x: 2.5 }),
  getter: () => { let n = 0; return { x: 2.5, get y() { log.push("get y " + ++n); return n; } }; }, throws: () => ({ x: 2.5, get y() { log.push("y throws"); throw new RangeError("no y"); } }),
  inherits: () => Object.create({ x: 2.5, y: 3.5 }), list: () => [2.5, 3.5], nothing: () => null, missing: () => undefined, number: () => 7, frozen: () => Object.freeze({ x: 2.5, y: 3.5 }),
  object: () => ({ x: 2.5, y: { valueOf() { log.push("valueOf"); return 4.5; } } }), big: () => ({ x: 2.5, y: 3n }),
};
const with1 = (kind: string, at: number): any[] => { const rows = records(); rows.splice(at, 1, odd[kind]!()); return rows; };
const givers: Record<string, (rows: any[]) => any> = {
  list: rows => rows, set: rows => new Set(rows),
  generator: rows => (function* () { try { for (let i = 0; i < rows.length; i++) yield rows[i]; } finally { log.push("finally"); } })(),
  object: rows => ({ [Symbol.iterator]() { let i = 0; return { next() { return i < rows.length ? { value: rows[i++], done: false } : { value: undefined, done: true }; }, return(v: any) { log.push("closed at " + i); return { value: v, done: true }; } }; } }),
};
function turns(given: any, to: any, other: any, note: any): any { let sum: any = 0; for (const p of given) { for (let c = 0; c < to.length; c++) { const dx = p.x - to[c].x; note(c); const dy = p.y - other[c].y; sum = sum + dx * dy; } } return sum; }
for (let round = 0; round < 3; round++) {
  for (const giver of Object.keys(givers)) for (const kind of Object.keys(odd)) for (const at of [0, 2, 3]) {
    log = []; say("rows " + giver + " " + kind + " " + at, () => turns(hide(givers[giver]!(records())), hide(records()), hide(with1(kind, at)), hide((c: number) => { log.push("turn " + c); }))); out.push(log.join(","));
    log = []; say("points " + giver + " " + kind + " " + at, () => turns(hide(givers[giver]!(with1(kind, at))), hide(records()), hide(records()), hide((c: number) => { log.push("turn " + c); }))); out.push(log.join(","));
  }
  if (round < 2) out.length = 0;
}
let hash = 0; for (const line of out) for (let i = 0; i < line.length; i++) hash = (Math.imul(hash, 31) + line.charCodeAt(i)) | 0;
console.log(out.length, hash); for (const pick of [0, 9, 40, 88, 150, 301, 444, 610]) console.log(out[pick % out.length]);
console.log(out.filter(line => line.includes(" threw ")).length, out.filter(line => line.includes("closed at")).length, out.filter(line => line.includes("finally")).length, out.filter(line => line.includes("get y")).length);
export {};
