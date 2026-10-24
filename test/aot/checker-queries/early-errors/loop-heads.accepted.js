// Valid loop heads that look like the rejected ones.
for (let a of []) {}
for (var [a] in {}) {}
for (const { a } of []) {}
for (let a in {}) {}
for await (const a of []) {}
async function f() { for await (const a of []) {} }
for ((async) of []) {}
var async; for await (async of []) {}
for (let a = 1, b;;) { break; }
// ECMAScript rejects the next one in strict mode code. bun run starts it: its transpiler moves the initializer in front of the loop.
for (var a = 1 in {}) {}
