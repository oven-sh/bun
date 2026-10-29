// Values of a class below a built-in class meet values of ordinary classes and literals in unions, interfaces, arrays and fields, and one function reads, stores, freezes, lists and copies them all.
const lines: string[] = [];
interface Counter {
  count: number;
  label: string;
  twice(): number;
}
class Plain implements Counter {
  count = 1;
  label = "plain";
  twice(): number { return this.count * 2; }
}
class Other implements Counter {
  label = "other";
  extra = true;
  count = 2;
  twice(): number { return this.count * 2 + 1; }
}
class OnMap extends Map<string, number> implements Counter {
  count = 3;
  label = "map";
  twice(): number { return this.count * 2 + this.size; }
}
class OnError extends Error implements Counter {
  count = 4;
  label = "error";
  twice(): number { return this.count * 2 + this.message.length; }
}
class OnSet extends Set<number> implements Counter {
  label = "set";
  count = 5;
  twice(): number { return this.count * 2 + this.size; }
}
const literal: Counter = { count: 6, label: "literal", twice() { return this.count * 2; } };
function make(): Counter[] {
  return [new Plain(), new OnMap([["a", 1]]), new Other(), new OnError("four"), new OnSet([1, 2]), { ...literal }];
}
function read(k: Counter): string { return k.count + k.label + k.twice(); }
function store(k: Counter, value: number): number { k.count = value; k.label += "!"; return k.count; }
function readUnion(k: Plain | OnMap | OnError): string { return k.count + k.label + k.twice() + (k instanceof OnMap ? k.get("a") : k instanceof OnError ? k.message : "-"); }
function storeUnion(k: Plain | OnMap | OnSet, value: number): string { k.count += value; return Object.keys(k).join(); }
function freeze(k: Counter): boolean { return Object.isFrozen(Object.freeze(k)); }
function freezeUnion(k: Plain | OnMap): boolean { return Object.isFrozen(Object.freeze(k)); }
function seal(k: Other | OnError): boolean { return Object.isSealed(Object.seal(k)); }
function reparent(k: Plain | OnSet): string { Object.setPrototypeOf(k, Other.prototype); return String(k.twice()); }
function copy(k: Counter): string { return JSON.stringify({ ...k }) + JSON.stringify(Object.assign({}, k)) + JSON.stringify(k); }
function copyInto(to: Plain | OnMap, from: Other | OnError): string { Object.assign(to, from); return to.count + to.label + Object.keys(to).join(); }
function list(k: Counter): string { const names: string[] = []; for (const name in k) names.push(name); return names.join() + "/" + Object.keys(k).length + "/" + Object.values(k).length; }
function remove(k: Plain | OnMap | OnError): string { delete (k as any).label; return String(k.label) + Object.keys(k).join(); }
class Holder {
  first: Counter;
  second: OnMap;
  third: Plain | OnError;
  constructor(first: Counter, second: OnMap, third: Plain | OnError) { this.first = first; this.second = second; this.third = third; }
  sum(): number { return this.first.twice() + this.second.twice() + this.third.twice() + this.second.size; }
}
for (let round = 0; round < 3; round++) {
  for (const each of make()) lines.push(read(each) + " " + store(each, round) + " " + read(each) + " " + copy(each) + " " + list(each));
  lines.push(readUnion(new Plain()), readUnion(new OnMap([["a", 7]])), readUnion(new OnError("e")));
  lines.push(storeUnion(new Plain(), 1), storeUnion(new OnMap(), 2), storeUnion(new OnSet(), 3));
  lines.push(copyInto(new Plain(), new Other()), copyInto(new OnMap(), new Other()), copyInto(new Plain(), new OnError("x")), copyInto(new OnMap(), new OnError("y")));
  lines.push(remove(new Plain()), remove(new OnMap()), remove(new OnError("z")));
  const frozen = make();
  lines.push(frozen.map(freeze).join());
  for (const each of frozen) { try { "use strict"; store(each, 9); lines.push("stored " + read(each)); } catch (e) { lines.push((e as Error).name + " " + read(each)); } }
  lines.push(String(freezeUnion(new Plain())), String(freezeUnion(new OnMap())), String(seal(new Other())), String(seal(new OnError("s"))));
  lines.push(reparent(new Plain()), reparent(new OnSet([1])));
  const holder = new Holder(new OnSet([1]), new OnMap([["a", 1]]), new OnError("held"));
  lines.push(String(holder.sum()));
  holder.first = new OnMap(); holder.third = new Plain();
  lines.push(String(holder.sum()));
  Bun.gc(true);
  lines.push(String(holder.sum()), frozen.map(read).join());
}
console.log(lines.join("\n"));
