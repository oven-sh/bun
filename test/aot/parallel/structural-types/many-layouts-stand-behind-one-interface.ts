interface Node {
  kind: string;
  value: number;
  weight(): number;
}

class A0 { kind = "A0"; value = 0; weight(): number { return this.value + 100; } }
class A1 { value = 1; kind = "A1"; weight(): number { return this.value + 101; } }
class A2 { pad = 0; kind = "A2"; value = 2; weight(): number { return this.value + 102; } }
class A3 { kind = "A3"; pad = 0; value = 3; weight(): number { return this.value + 103; } }
class A4 { kind = "A4"; value = 4; pad = 0; weight(): number { return this.value + 104; } }
class A5 { p = 0; q = 0; kind = "A5"; value = 5; weight(): number { return this.value + 105; } }
class A6 { p = 0; kind = "A6"; q = 0; value = 6; weight(): number { return this.value + 106; } }
class A7 { value = 7; p = 0; q = 0; r = 0; kind = "A7"; weight(): number { return this.value + 107; } }
class A8 extends A0 { kind = "A8"; value = 8; weight(): number { return super.weight() + 8; } }
class A9 extends A1 { extra = "x"; weight(): number { return -9; } }
class A10 { kind = "A10"; get value(): number { return 10; } weight(): number { return 110; } }
class A11 { kind = "A11"; value = 11; weight = (): number => 111; }

const literals: Node[] = [
  { kind: "L0", value: 20, weight: () => 120 },
  { value: 21, kind: "L1", weight: () => 121 },
  { weight: () => 122, value: 22, kind: "L2" },
  { kind: "L3", value: 23, weight() { return this.value + 100; } },
];

function grown(count: number): Node {
  const extras: Record<string, number> = {};
  for (let i = 0; i < count; i++) extras["e" + i] = i;
  return Object.assign(extras, { kind: "G" + count, value: 30 + count, weight: () => 130 + count });
}

function everything(): Node[] {
  const all: Node[] = [new A0(), new A1(), new A2(), new A3(), new A4(), new A5(), new A6(), new A7(), new A8(), new A9(), new A10(), new A11(), ...literals];
  for (let count = 0; count < 70; count++) all.push(grown(count));
  return all;
}

function value(n: Node): number {
  return n.value;
}

function weight(n: Node): number {
  return n.weight();
}

function kind(n: Node): string {
  return n.kind;
}

const all = everything();
console.log("how many: " + all.length);
console.log("kinds: " + all.map(kind).join());
console.log("values: " + all.map(value).join());
console.log("weights: " + all.map(weight).join());

let total = 0;
for (let round = 0; round < 50; round++) for (const n of all) total += n.value + n.weight();
console.log("fifty rounds: " + total);

for (const n of all) {
  if (!(n instanceof A10)) n.value += 1000;
}
console.log("after stores: " + all.map(value).join());
console.log("weights again: " + all.map(weight).join());

let honest = 0;
const only = new A0();
for (let i = 0; i < 2000; i++) honest += value(only) + weight(only);
console.log("2000 of one class: " + honest);
console.log("backwards through all: " + [...all].reverse().map(n => kind(n) + ":" + value(n)).slice(0, 12).join());

const byKind = new Map<string, Node>();
for (const n of all) byKind.set(n.kind, n);
console.log("out of a map: " + ["A7", "L2", "G69", "A10", "G0"].map(k => byKind.get(k)?.weight()).join());

console.log("key counts: " + all.map(n => Object.keys(n).length).join());

export {};
