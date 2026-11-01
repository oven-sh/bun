// A protocol or `instanceof` applies a built-in function to receivers that the analysis has put together in that very step. The build runs every rule once more over the solved sets, and nothing may be added.
// Flags: --aot-check=flow-fixpoint
const dated = {
  toJSON: Date.prototype.toJSON,
  toISOString() {
    return "the time of the object";
  },
};
console.log(JSON.stringify(dated));

const headers = new Headers([["a", "1"]]);
const entries = headers.entries();
const holder = {
  [Symbol.iterator]() {
    return entries;
  },
};
for (const [name, value] of holder) console.log(name, value, typeof value);

const listed = {
  toLocaleString: Array.prototype.toLocaleString,
  length: 1,
  0: {
    toLocaleString() {
      return "the element";
    },
  },
};
console.log([listed].toLocaleString());

class Even {
  static [Symbol.hasInstance](n) {
    return n % 2 === 0;
  }
}
const boundClass = Even.bind(null);
console.log(2 instanceof boundClass, 3 instanceof boundClass);

class Worker {
  constructor() {
    this.run = this.run.bind(this);
  }
  run() {
    return 1;
  }
}
const worker = new Worker();
for (const tested of [worker, 1]) {
  try {
    console.log(tested instanceof worker.run);
  } catch (error) {
    console.log(error.constructor.name);
  }
}
