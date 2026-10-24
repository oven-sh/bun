// A value that is a module namespace object or a record: a test for the namespace of one module passes for that object alone, and each read goes to the export or to the field.
import * as first from "./first";
import * as second from "./second";
interface Named { name: string; size: number; grow(): void }
type Either = typeof first | typeof second | Named;
function record(size: number): Named { return { name: "record", size, grow() { this.size += 30; } }; }
function pick(which: number): Either { return which === 0 ? first : which === 1 ? second : record(which); }
function nameOf(value: Either): string { return value.name; }
function sizeOf(value: Either): number { return value.size; }
function grown(value: Either): number { value.grow(); return value.size; }
function firstOrRecord(takesFirst: boolean): typeof first | Named { return takesFirst ? first : record(7); }
function whichOf(value: Either): string { return value === first ? "is first" : value === second ? "is second" : "is a record"; }
for (let round = 0; round < 3; round++) {
  for (let which = 0; which < 4; which++) {
    const value = pick(which);
    console.log(round, which, nameOf(value), sizeOf(value), grown(value), whichOf(value), Object.keys(value).join());
  }
}
console.log(firstOrRecord(true).name, firstOrRecord(true).size, firstOrRecord(false).name, firstOrRecord(false).size);
console.log(first.size, second.size);
