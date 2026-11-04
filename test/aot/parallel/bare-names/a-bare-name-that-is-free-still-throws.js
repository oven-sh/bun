// A name that nothing declares is read, and throws.
function touch() { try { nobodyDeclaresThis; return "no throw"; } catch (e) { return e.name; } }
console.log(touch());
globalThis.nobodyDeclaresThis = 1;
console.log(touch());
