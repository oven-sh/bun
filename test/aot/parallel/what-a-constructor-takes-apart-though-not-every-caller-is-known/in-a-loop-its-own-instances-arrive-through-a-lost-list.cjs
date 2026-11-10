"use strict";
// A copying constructor in a loop; its instances lie in a list that is out of sight; in some turns a record out of data arrives instead.
class Plate { constructor(from) { this.wide = from.wide; this.tall = from.tall; this.mark = from.mark; } }
function first(i) { const plate = Object.create(Plate.prototype); plate.wide = i; plate.tall = i / 2; plate.mark = "m" + i; return plate; }
const held = JSON.parse('{"rows":[{"wide":70,"tall":0.25,"mark":"r"}]}'); held.list = [];
for (let i = 0; i < 12; i++) held.list.push(i % 5 === 3 ? held.rows[0] : new Plate(first(i)));
function run(turn) { let sum = turn & 1, marks = ""; for (let i = 0; i < 12; i++) { const plate = new Plate(held.list[i]); sum += plate.wide + plate.tall; marks += plate.mark; } return sum + ":" + marks; }
console.log(run(0), run(1), run(2));
