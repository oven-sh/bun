// gives a fresh object another prototype, calling Object.setPrototypeOf through a value
const parent = { kind: "parent" };
const setPrototype: (object: object, prototype: object) => object = [Object.setPrototypeOf][0]!;
const operations = 160;
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const made = { name: "n", size: i };
    setPrototype(made, parent);
    total += made.size;
  }
}

console.log(total);
