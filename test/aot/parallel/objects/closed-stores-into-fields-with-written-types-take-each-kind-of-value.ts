// A store by name through a receiver that is written `any`, into fields whose types are written: the store is closed, and the slot is held to what is written.
// What the written type takes stays in the slot, however the kinds take turns. What it does not take is stored all the same, as the language has it, however many values of the right kind came before.
// Under: --aot-testing=CheckProofsAtRunTime: the type that a slot is held to
interface Ranged { pos: number; owner: Holder | undefined; open: boolean; label: string }
class Holder { id: number; constructor(id: number) { this.id = id; } }
class Alpha implements Ranged { a: number = 1; pos: number = 0; owner: Holder | undefined = undefined; open: boolean = false; label: string = "alpha"; }
class Beta implements Ranged { pos: number = 0; b: string = "b"; c: number = 2; owner: Holder | undefined = undefined; label: string = "beta"; open: boolean = false; }
class Gamma implements Ranged { owner: Holder | undefined = undefined; open: boolean = true; d: number = 1; e: number = 2; f: number = 3; label: string = "gamma"; pos: number = 0; }
class Delta implements Ranged { label: string = "delta"; g: number[] = [1]; open: boolean = false; pos: number = 0; owner: Holder | undefined = undefined; }
class Epsilon implements Ranged { h: number = 0.5; i: number = 1; j: number = 2; k: number = 3; pos: number = 0; label: string = "epsilon"; owner: Holder | undefined = undefined; open: boolean = true; }
function setPos(range: any, pos: unknown): void { range.pos = pos; }
function setOwner(range: any, owner: unknown): void { range.owner = owner; }
function setOpen(range: any, open: unknown): void { range.open = open; }
function setLabel(range: any, label: unknown): void { range.label = label; }
const setters = [setPos, setOwner, setOpen, setLabel];
function put(range: Ranged, which: number, value: unknown): void { setters[which](range, value); }
function twice(range: Alpha | Beta | Gamma | Delta | Epsilon): number { return range.pos * 2; }
function describe(range: Ranged): string {
  const owner: unknown = range.owner;
  return `${typeof range.pos} ${String(range.pos)} ${owner instanceof Holder ? "holder " + owner.id : typeof owner + " " + String(owner)} ${typeof range.open} ${String(range.open)} ${typeof range.label} ${String(range.label)}`;
}
function make(index: number): Alpha | Beta | Gamma | Delta | Epsilon {
  switch (index % 5) {
    case 0: return new Alpha();
    case 1: return new Beta();
    case 2: return new Gamma();
    case 3: return new Delta();
    default: return new Epsilon();
  }
}
const ranges = Array.from({ length: 10 }, (_, index) => make(index));
const holders = [new Holder(1), new Holder(2)];
let total = 0;
for (let turn = 0; turn < 500; turn++) {
  const range = ranges[turn % ranges.length];
  put(range, 0, turn);
  put(range, 1, turn % 3 ? holders[turn % 2] : undefined);
  put(range, 2, turn % 2 === 0);
  put(range, 3, "label " + (turn % 7));
  total += twice(range);
}
console.log(total);
for (const range of ranges) console.log(describe(range));
for (let turn = 0; turn < 500; turn++) {
  const range = ranges[turn % ranges.length];
  put(range, 0, turn + 0.25);
  total += twice(range);
}
console.log(total, describe(ranges[4]));
// Kinds that the written types do not take.
put(ranges[0], 0, "a text");
put(ranges[1], 0, holders[0]);
put(ranges[2], 0, true);
put(ranges[3], 1, 7);
put(ranges[4], 1, "no holder");
put(ranges[5], 1, ranges[6]);
put(ranges[6], 2, 1);
put(ranges[7], 2, "yes");
put(ranges[8], 3, 12);
put(ranges[9], 3, holders[1]);
put(ranges[9], 0, null);
for (const range of ranges) console.log(describe(range), String(twice(range)));
// The right kinds again, into the same objects and into fresh ones.
for (let turn = 0; turn < 200; turn++) {
  const range = turn % 2 ? ranges[turn % ranges.length] : make(turn);
  put(range, 0, turn);
  put(range, 1, holders[turn % 2]);
  put(range, 2, false);
  put(range, 3, "again");
  total += twice(range);
}
console.log(total);
for (const range of ranges) console.log(describe(range));
const frozen = Object.freeze(make(3));
try {
  put(frozen, 0, 9);
  console.log("stored");
} catch (error) {
  console.log((error as Error).constructor.name);
}
console.log(frozen.pos);
