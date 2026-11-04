// The barrel of a pure package is loaded by import(), and the callback given to then() reads one name from its parameter, once as a member and once in a pattern. `bun run` evaluates the three files behind the barrel. `bun build --compile` follows the parameter of the callback and evaluates a.js and b.js alone.
// Reference: bun build --compile
console.log(await import("by-import-then").then(module => module.a()));
console.log(await import("by-import-then").then(({ b }) => b()));
