// Array.prototype stays extensible in a compiled program, but it takes no key that the language makes of `undefined`, `null`, `true` or `false`. A store that would add one and that every run reaches stops the build. language/keys-made-of-primitives-are-closed has the stores that throw when they run, and the names that can be added.
Array.prototype[undefined] = "found";
console.log([][undefined]);
export {};
