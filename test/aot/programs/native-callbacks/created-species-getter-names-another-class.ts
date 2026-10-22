// Held from creation: a static Symbol.species getter answers with another class of the program, which native code then constructs with a length, while every `new` of that class in the program passes a string.
let total = 0;

class Named extends Array<number> {
  constructor(name: string) {
    super();
    total += typeof name === "string" ? 1 : typeof name === "number" ? 100 + name : 10000;
  }
}

class Source extends Array<number> {
  static get [Symbol.species](): any {
    total += 1000000;
    return Named;
  }
}

new Named("mine");
const source = Source.from([1, 2, 3]);
const results = [source.map(one => one * 2), source.filter(one => one > 1), source.slice(1), source.concat([4])];
console.log(total, results.map(one => (one instanceof Named) + ":" + (one instanceof Source) + ":" + one.join("")).join(" "));
