// The form of the finding, with a listed name: a helper lays the setter by a written descriptor on a literal and on an instance, and the setter stores a text where both list a number. The literal may be carried out.
class Cell { n = 0; got = 0; }
function laid(held) { Object.defineProperty(held, "level", { set(next) { this.got = "s" + next; } }); return held; }
function give(held, next) { held.level = next; return typeof held.got; }
const record = laid({ n: 0, got: 0 });
const cell = laid(new Cell());
let words = "";
try { JSON.parse(process.argv[2] ?? "{}"); } catch (error) { error.where = record; words = error.toString(); }
console.log(give(cell, 5), give(record, 5), cell.got + 1, record.got + 1, words.length);
