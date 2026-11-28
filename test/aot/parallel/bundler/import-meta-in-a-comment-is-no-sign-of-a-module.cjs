// Flags: --format=cjs --define=import.meta=shim
// Reference: bun build --compile
/** @param {string} [folder=import.meta.dir] */
function read(folder) { return folder; }
this.answer = read(42);
console.log(this.answer);
