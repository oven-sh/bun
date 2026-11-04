class Mine extends Array { static get [Symbol.species]() { return Array; } }
console.log(new Mine(1, 2, 3).map(x => x) instanceof Mine);
