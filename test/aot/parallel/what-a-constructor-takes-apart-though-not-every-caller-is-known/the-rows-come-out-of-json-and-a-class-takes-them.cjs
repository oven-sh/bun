"use strict";
// The same with a class; its instances go out of sight, so its callers are not all known.
class Plate { constructor(from) { this.wide = from.wide; this.tall = from.tall; this.mark = from.mark; } area() { return this.wide * this.tall; } }
const rows = JSON.parse('[' + Array.from({ length: 6 }, (_, i) => '{"wide":' + (i + 1) + ',"tall":' + (i * 2 + 0.5) + ',"mark":"m' + i + '"}').join() + ']');
globalThis.kept = [];
function run(turn) {
    const plates = rows.map(row => new Plate(row));
    return plates.map(plate => (globalThis.kept.push(plate), plate.mark + ":" + plate.area())).join(" ");
}
const printed = [];
for (let turn = 0; turn < 4; turn++) printed.push(run(turn));
console.log(printed.join(" | "));
