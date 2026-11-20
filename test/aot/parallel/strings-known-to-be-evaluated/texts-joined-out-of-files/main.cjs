// A package joins texts of its own files, one of them no code by its name, into functions, and another one evaluates what a module beside it holds as text.
const kit = require("./kit");
const spelled = require("./spelled-out");
let sum = 0;
for (let turn = 0; turn < 200; turn++) sum += kit.area(turn % 9, 3) + kit.ring(turn % 5) + kit.add(turn & 3);
console.log(sum, kit.total(), kit.shown("w"), Object.keys(kit).sort().join());
console.log(spelled.words.join(), spelled.longest(spelled.words), spelled.doubled(21));
console.log(kit.area.name, kit.area.length, typeof kit.hidden, kit.strictThis());
