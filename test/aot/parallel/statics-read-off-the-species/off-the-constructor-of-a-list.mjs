const made = [1, 2].map(x => x);
console.log(made.constructor[Symbol.species].from("ab").length, new made.constructor[Symbol.species](3).length);
