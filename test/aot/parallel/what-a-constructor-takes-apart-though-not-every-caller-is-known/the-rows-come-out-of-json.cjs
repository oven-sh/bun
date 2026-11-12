"use strict";
// Rows of parsed data are laid into objects by a constructor function; an arrow handed to map makes them.
function Plate(from) { this.wide = from.wide; this.tall = from.tall; this.mark = from.mark; }
Plate.prototype.area = function () { return this.wide * this.tall; };
const rows = JSON.parse('[' + Array.from({ length: 6 }, (_, i) => '{"wide":' + (i + 1) + ',"tall":' + (i * 2 + 0.5) + ',"mark":"m' + i + '"}').join() + ']');
function run(turn) {
    const plates = rows.map(row => new Plate(row));
    return plates.map(plate => plate.mark + ":" + plate.area() + ":" + Object.keys(plate).join("+")).join(" ");
}
const printed = [];
for (let turn = 0; turn < 4; turn++) printed.push(run(turn));
console.log(printed.join(" | "));
