const xs: number[] = JSON.parse("[" + Array.from({ length: 48 }, (_, k) => (k * 37) % 101).join() + "]");
const parsed: string = JSON.parse('"go"');
const declared: "go" | "no" = process.argv.length > 9 ? "no" : "go";
const names: string[] = ["go", "no", "go"];
const steps: { op: string; by: number }[] = JSON.parse('[{"op":"no","by":1},{"op":"go","by":2},{"op":"no","by":3}]');
const symbol = Symbol("go");

const record: Record<string, (x: number) => number> = { go: x => x + 1, no: x => x * 2 };
const literal = { go(x: number) { return x + 1; }, no(x: number) { return x * 2; }, count: 3 };
const frozen = Object.freeze({ go: (x: number) => x - 1, no: (x: number) => x * 3 });
const wide: Record<string, (x: number) => number> = { a: x => x, b: x => x + 2, c: x => x + 3, d: x => x + 4, e: x => x + 5, f: x => x + 6, go: x => x + 7, no: x => -x };
const bare = Object.create(null);
bare.go = (x: number) => x + 11;
bare.no = (x: number) => x * 11;
class Statics {
  static step = 4;
  static go(x: number) { return x + this.step; }
  static no(x: number) { return x * 2; }
}
class Heirs extends Statics {
  static override no(x: number) { return x * 5; }
}
class Counter {
  calls = 0;
  go(x: number) { this.calls++; return x + this.calls; }
  no(x: number) { return x * 2; }
}
class Child extends Counter {
  override no(x: number) { return x * 7 + this.calls; }
}
const counter = new Counter();
const child = new Child();
const marked = { [symbol]: (x: number) => x + 100, go: (x: number) => x + 1 };
const list = [(x: number) => x + 1, (x: number) => x * 2];
const indexes: number[] = JSON.parse("[0,1,1]");

const handlers = new Map<string, (x: number) => number>();
handlers.set("go", x => x + 13);
handlers.set("no", x => x * 13);
const entries = new Map<string, (x: number) => number>([["go", x => x - 13], ["no", x => -x]]);

function show(name: string, run: () => unknown): void {
  const said: string[] = [];
  for (let round = 0; round < 3; round++) {
    try {
      said.push(String(run()));
    } catch (error) {
      said.push(error instanceof Error ? error.name : String(error));
    }
  }
  console.log(name, said.join(" "));
}

function parsedKeys() {
  let s = 0;
  for (const x of xs) s = (s + record[parsed]!(x) + (literal as any)[parsed](x) + (frozen as any)[parsed](x)) | 0;
  return s;
}
function declaredKeys() {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s = (s + literal[declared](xs[i]!) * frozen[declared](i)) | 0;
  return s;
}
function keysOfList() {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s = (s + record[names[i % 3]!]!(xs[i]!)) | 0;
  return s;
}
function keysOfRecords() {
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    const step = steps[i % 3]!;
    s += wide[step.op]!(xs[i]!) * step.by;
  }
  return s;
}
function staticMethods() {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += (Statics as any)[parsed](xs[i]) + (Heirs as any)[names[i % 3]!](i);
  return s;
}
function instanceMethods() {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += (counter as any)[parsed](xs[i]) + (child as any)[names[i % 3]!](i);
  return s + counter.calls + child.calls;
}
function otherHolders() {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += bare[names[i % 3]!](xs[i]) + (marked as any)[i & 1 ? symbol : "go"](i) + list[indexes[i % 3]!]!(i);
  return s;
}
function maps() {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += handlers.get(parsed)!(xs[i]!) + handlers.get(names[i % 3]!)!(i) + entries.get(steps[i % 3]!.op)!(i);
  return s;
}
function mapChanged() {
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    s += handlers.get(parsed)!(xs[i]!);
    if (i === 20) handlers.set("go", x => x * 1000);
    if (i === 30) handlers.delete("no");
    if (i === 40) s += handlers.get("no")?.(1) ?? 7;
  }
  return s;
}
function ownKeys() {
  let s = 0;
  for (const name of Object.keys(record)) for (let i = 0; i < xs.length; i++) s += record[name]!(xs[i]!);
  return s;
}
function texts() {
  let text = "";
  for (let i = 0; i < xs.length; i++) text += record[names[i % 3]!]!(xs[i]!) + ",";
  return text.length + text.slice(0, 20);
}
function missing() {
  let s = 0;
  const keys = ["go", "no", "nothing"];
  for (let i = 0; i < xs.length; i++) {
    s += record[keys[i % 3]!]!(xs[i]!);
    if (i === 30) return s;
  }
  return s;
}
function optional() {
  let s = 0;
  const keys = ["go", "nothing", "no"];
  for (let i = 0; i < xs.length; i++) s += record[keys[i % 3]!]?.(xs[i]!) ?? 1000;
  return s;
}
function step(key: string, x: number) {
  return record[key]!(x) + (literal as any)[key](x);
}
function copied() {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += step(names[i % 3]!, xs[i]!) + step(parsed, i);
  return s;
}

show("parsed", parsedKeys);
show("declared", declaredKeys);
show("list", keysOfList);
show("records", keysOfRecords);
show("statics", staticMethods);
show("instances", instanceMethods);
show("others", otherHolders);
show("maps", maps);
show("map changed", mapChanged);
show("own keys", ownKeys);
show("texts", texts);
show("missing", missing);
show("optional", optional);
show("copied", copied);
let total = 0;
for (let round = 0; round < 4; round++) for (let i = 0; i < xs.length; i++) total = (total + record[parsed]!(xs[i]!) + (Statics as any)[parsed](i) + (counter as any)[names[i % 3]!](i)) | 0;
console.log(total);
