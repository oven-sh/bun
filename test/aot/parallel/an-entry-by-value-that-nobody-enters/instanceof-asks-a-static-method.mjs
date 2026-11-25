// instanceof asks a static method of the class, out of the engine's own code.
class Even { static [Symbol.hasInstance](value) { return value % 2 === 0; } }
let hits = 0;
for (let turn = 0; turn < 300; turn++) if (turn instanceof Even) hits++;
console.log(hits);
