// A static method of a built-in that a variable of the file holds beside `undefined`, in a program that names no other `from` and has a class below a typed array.
class FastBuffer extends Uint8Array {}
const Instant = globalThis.Temporal?.Instant;
function at(text) {
  return Instant.from(text);
}
let said;
try {
  said = String(at("2026-11-13T00:00Z"));
} catch (error) {
  said = error.name;
}
console.log(new FastBuffer(2).length, said);
