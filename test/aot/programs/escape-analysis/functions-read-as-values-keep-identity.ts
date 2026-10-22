// A function declaration, a static field and a method read as values have one identity each.
declare const console: any;
declare const Bun: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }
const held: any[] = [];

function plain(): number { return 1; }
function d1(): void { say("declaration/twice", plain === plain); held.push(plain); say("declaration/held", held[held.length - 1] === plain); (plain as any).tag = 3; Bun.gc(true); say("declaration/tag", (plain as any).tag); }
function readsPlain(): unknown { return plain; }
function d2(): void { say("declaration/from-a-callee", readsPlain() === plain && readsPlain() === readsPlain()); }

class K3 { static run = () => 3; static other(): number { return 4; } method(): number { return 5; } }
function d3(): void {
  say("static-field", K3.run === K3.run); say("static-method", K3.other === K3.other);
  const a = new K3(), b = new K3();
  say("method", a.method === b.method && a.method === K3.prototype.method);
  held.push(K3.run); say("static-field/held", held[held.length - 1] === K3.run);
}

function outer4(): () => number { function inner(): number { return 4; } return inner; }
function d4(): void { say("inner-declaration", outer4() === outer4()); const f = outer4(); say("inner-declaration/same", f === f); }

const table5 = { a: () => 1, b: () => 2, c: function named() { return 3; }, d() { return 4; } };
function d5(): void {
  say("module-table", table5.a === table5.a && table5.b === table5.b && table5.c === table5.c && table5.d === table5.d);
  say("module-table/different", (table5.a as unknown) === table5.b);
  const seen = new Set<unknown>(); for (const key of Object.keys(table5)) seen.add((table5 as any)[key]); for (const value of Object.values(table5)) seen.add(value);
  say("module-table/set", seen.size); say("module-table/names", Object.values(table5).map(f => f.name).join(","));
}

interface R6 { m: () => number }
function make6(): R6 { return { m: () => 6 }; }
function d6(): void { const list: R6[] = [make6(), make6()]; const first = list.map(r => r.m); Bun.gc(true); const second = list.map(r => r.m); say("mapped-twice", first[0] === second[0] && first[1] === second[1] && first[0] !== first[1]); }

interface R7 { m: () => number; next?: R7 }
function make7(next?: R7): R7 { return { m: () => 7, next }; }
function d7(): void { const chain = make7(make7(make7())); const seen = new Set<unknown>(); for (let r: R7 | undefined = chain; r; r = r.next) { seen.add(r.m); seen.add(r.m); } say("chain", seen.size); }

function d8(): void { const o = { m: () => 8 }; const bound = o.m.bind(null); say("bound", bound() + "/" + (o.m === o.m) + "/" + ((bound as unknown) === o.m)); say("call-apply", o.m.call(null) + o.m.apply(null, [])); }

function d9(): void { const o = { m: () => 9 }; const text = JSON.stringify(o); const f = o.m; say("stringify", text + "/" + (f === o.m)); say("in", ("m" in o) + "/" + Object.hasOwn(o, "m") + "/" + Object.keys(o).join()); }

d1(); d2(); d3(); d4(); d5(); d6(); d7(); d8(); d9();
console.log(out.join("\n"));
