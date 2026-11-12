// door.cjs shows `level` of gauge.cjs by a getter that is not enumerable, and gauge.cjs stores the name again later. Each ES file that imports the name holds what it found when it was linked:
// what the second one finds through the door does not change what the first one holds.
// Neither plain prints this whole: `bun main.cjs` finds no export under a getter that is not enumerable (SyntaxError), and a bundle reads the names of a CommonJS file live (2, true 2, 3 3).
const first = require("./first.mjs");
first.poke();
const before = first.read();
console.log(before);
const second = require("./second.mjs");
console.log(before === first.read(), second.seen);
first.poke();
console.log(first.read(), second.read());
/* Output:
1
true 2
1 2
*/
