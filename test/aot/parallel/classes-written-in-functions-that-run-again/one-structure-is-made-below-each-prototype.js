// Below each prototype ONE structure is made, whoever asks and however late: the run time may pass the search by only for the FIRST that asks below a prototype.
// Six thousand evaluations of one class are kept and none is constructed. One more is evaluated and constructed. Then each of the older ones is constructed for the first time: that pushes the last one out of the
// small table of the prototypes that were met last, and no class is evaluated meanwhile. Then the last one is constructed again: the structure that stands below its prototype is found.
// COUNT: counter:CompiledStructuresMade <= 6002
"use strict";
function make() {
  return class Lone { constructor(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.size = n + work; } };
}
const older = [];
for (let each = 0; each < 6000; each++) older.push(make());
const last = make();
const first = new last(2);
let sum = first.size;
for (const Class of older) sum += new Class(1).size;
const again = new last(3);
sum += again.size + (Object.getPrototypeOf(again) === Object.getPrototypeOf(first) ? 1 : 1000000);
console.log(sum);
