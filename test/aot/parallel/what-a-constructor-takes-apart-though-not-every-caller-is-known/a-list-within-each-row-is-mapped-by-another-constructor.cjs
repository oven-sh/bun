"use strict";
// The orders: a constructor maps a list of its record by another constructor.
function Plate(from) { this.wide = from.wide; this.tall = from.tall; this.mark = from.mark; }
Plate.prototype.area = function () { return this.wide * this.tall; };
function Shelf(from) { this.name = from.name; this.plates = from.plates.map(plate => new Plate(plate)); }
const rows = JSON.parse('[' + Array.from({ length: 4 }, (_, i) => '{"name":"s' + i + '","plates":[' + Array.from({ length: 1 + i % 3 }, (_, j) => '{"wide":' + (i + j + 1) + ',"tall":' + (j + 0.5) + ',"mark":"m' + j + '"}').join() + ']}').join() + ']');
function run(turn) {
    const plates = rows.map(row => new Shelf(row));
    return plates.map(plate => plate.name + ":" + plate.plates.map(one => one.area()).join("+")).join(" ");
}
const printed = [];
for (let turn = 0; turn < 4; turn++) printed.push(run(turn));
console.log(printed.join(" | "));
