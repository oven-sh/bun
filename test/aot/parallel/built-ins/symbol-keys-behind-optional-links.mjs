// A well-known symbol that is read behind `?.` is a computed key.
const steps = globalThis.Symbol?.iterator;
const name = globalThis?.Symbol.toStringTag;
class Bytes extends Uint8Array {}
console.log([...new Bytes([1, 2])].join(), [3, 4][steps]().next().value, [5, 6][globalThis.Symbol?.iterator]().next().value);
class Tagged {
  get [name]() {
    return "Tagged";
  }
}
console.log(String(new Tagged()));
const Marks = globalThis.Symbol;
const primitive = Marks?.toPrimitive;
console.log(`${{ [primitive]: () => "primitive" }}`);
