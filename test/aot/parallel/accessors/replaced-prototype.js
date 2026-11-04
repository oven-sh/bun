// `rec.size`: no record is made with the name, so only one that was handed another prototype finds something.
function make(id) {
  return { id };
}

function sizeOf(rec) {
  return rec.size;
}

function sum(recs, turns) {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) {
    for (const rec of recs) total += sizeOf(rec) ?? 0;
  }
  return total;
}

let calls = 0;
function sizedBy(factor) {
  return {
    get size() {
      calls++;
      return this.id * factor;
    },
  };
}

const plain = make(1);
const doubled = Object.setPrototypeOf(make(2), sizedBy(2));
const tripled = Object.setPrototypeOf(make(3), sizedBy(3));
console.log(sizeOf(plain), sizeOf(doubled), sizeOf(tripled), calls);
console.log(sum([plain, doubled, tripled], 100), calls);

const above = Object.getPrototypeOf(doubled);
Object.defineProperty(above, "size", {
  get() {
    return "another getter for " + this.id;
  },
  configurable: true,
});
console.log(sizeOf(doubled), sizeOf(tripled));

Object.defineProperty(above, "size", { value: 7, configurable: true });
console.log(sizeOf(doubled), sum([doubled], 40));

delete above.size;
console.log(sizeOf(doubled), sum([doubled], 40));

Object.defineProperty(above, "size", { set(value) {}, configurable: true });
console.log(sizeOf(doubled));

Object.defineProperty(tripled, "size", { value: "own", configurable: true });
console.log(sizeOf(tripled), sum([make(4)], 3));
delete tripled.size;
console.log(sizeOf(tripled), sum([tripled], 40));

const seen = [];
Object.setPrototypeOf(
  doubled,
  new Proxy(
    {},
    {
      get(target, key, receiver) {
        seen.push(String(key), receiver === doubled);
        return 11;
      },
    },
  ),
);
console.log(sizeOf(doubled), seen.join());

Object.setPrototypeOf(tripled, {
  get size() {
    throw new RangeError("no size for " + this.id);
  },
});
try {
  sizeOf(tripled);
} catch (error) {
  console.log(error.name, error.message);
}

Object.setPrototypeOf(tripled, null);
console.log(sizeOf(tripled), calls);

export {};
