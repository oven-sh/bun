class Results extends Array {
  static get [Symbol.species]() {
    return Array;
  }
}
const results = Results.from([1, 2, 3]);
console.log(results.map(x => x * 2).constructor.name);
