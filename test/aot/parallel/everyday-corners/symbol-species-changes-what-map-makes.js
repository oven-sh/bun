// Symbol species changes what map makes: compiled answers as plain.
class L extends Array {
  static get [Symbol.species]() {
    return Array;
  }
}
const l = L.from([1, 2, 3]);
console.log(l instanceof L, l.map(x => x) instanceof L, l.filter(Boolean).constructor.name, l.slice().constructor.name);
