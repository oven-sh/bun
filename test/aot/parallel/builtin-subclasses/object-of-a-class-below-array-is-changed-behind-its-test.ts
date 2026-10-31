class Bag extends Array<number> {
  size(): number { return this.length; }
  head(): number | undefined { return this[0]; }
  add(v: number): number { return this.push(v); }
  all(): number { let n = 0; for (const v of this) n += v; return n; }
}
function look(bag: Bag): string { return [bag.size(), bag.head(), bag.all(), bag.length, bag[1], bag.indexOf(2), bag.slice().length, bag.at(-1)].join(); }
function make(): Bag { const b = new Bag(); b.push(1, 2, 3); return b; }
for (let turn = 0; turn < 3; turn++) {
  let b = make(); console.log(look(b));
  (b as any).size = () => -1; console.log(look(b));
  b = make(); (b as any).push = function (v: number) { console.log("own push", v); return 0; }; console.log(b.add(4), look(b));
  b = make(); (b as any)[Symbol.iterator] = function* () { yield 100; }; console.log(look(b), [...b].join());
  b = make(); Object.setPrototypeOf(b, Array.prototype); console.log(b.length, b[0], b instanceof Bag, Array.isArray(b), (b as any).size);
  try { console.log(look(b)); } catch (e) { console.log((e as Error).constructor.name); }
  b = make(); Object.setPrototypeOf(b, null); console.log(b.length, b[0], Array.isArray(b));
  b = make(); Object.freeze(b); try { b.add(4); } catch (e) { console.log((e as Error).constructor.name); } console.log(look(b));
  b = make(); b[1] = 2.5; console.log(look(b)); (b as any)[2] = "x"; console.log(look(b)); b[100000] = 1; console.log(b.size(), b.head(), b[100000], b.indexOf(1, 5));
  b = make(); Object.defineProperty(b, 0, { get() { return 42; } }); console.log(look(b));
  b = make(); Object.defineProperty(b, "length", { writable: false }); try { b.add(4); } catch (e) { console.log((e as Error).constructor.name); } console.log(look(b));
  b = make(); b.length = 0; console.log(look(b)); b.length = 2; console.log(look(b));
}
