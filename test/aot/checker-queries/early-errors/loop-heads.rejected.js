// Declarations that the head of a for, for-in or for-of loop does not allow, for (async of, and for await outside of async code.
for (let a, b of []) {}
for (let a = 1 of []) {}
for (var a = 1 of []) {}
for (let a = 1 in {}) {}
for (var [a] = 1 in {}) {}
for (async of []) {}
for (let let of []) {}
for (const a;;) {}
function f() { for await (const a of []) {} }
for (using a in {}) {}
