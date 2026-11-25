// Tables that a function called as the file starts reads, in front of their store and behind it.
var out = [];
(function () { out.push(typeof EARLY, typeof TABLE); })();
var EARLY = [], TABLE = [1, 2, 3], RECORD = { a: 1 }, AGAIN = [];
(function () { for (var i = 0; i < 4; i++) { EARLY[i] = i * TABLE[i % 3]; AGAIN.push(EARLY[i]); } RECORD.b = AGAIN.length; })();
function fill(list) { list.push(AGAIN === list, EARLY === EARLY, RECORD.b); }
fill(AGAIN);
function read(i) { return [EARLY[i], TABLE[i], AGAIN[i], Object.keys(RECORD).join(), AGAIN.length].join(); }
for (var k = 0; k < 6; k++) out.push(read(k));
module.exports = { out: out };
console.log(out.join("|"));
