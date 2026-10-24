class Results extends Array {
  static get [Symbol.species]() {
    return Array;
  }
}
const made = new Results();
made.push(1, 2);
const results = process.argv.length > 5 ? JSON.parse("[1]") : made;
console.log(results.map(x => x * 2).constructor.name);
