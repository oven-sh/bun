// STATISTIC: PristineArrayGuardsSkipped >= 3
// An array that one loop has found pristine is not asked again before the next one, unless something has happened to it in between.

class Other {
  get 0() {
    return "zero";
  }
}
let seen = 0;
const changes = {
  nothing() {},
  push(a) {
    a.push(7);
  },
  text(a) {
    a[1] = "text";
  },
  hole(a) {
    delete a[1];
  },
  far(a) {
    a[a.length + 3] = 1;
  },
  getter(a) {
    Object.defineProperty(a, 1, { get: () => (seen++, 42), configurable: true, enumerable: true });
  },
  iterator(a) {
    a[Symbol.iterator] = function* () {
      yield 100;
    };
  },
  prototype(a) {
    Object.setPrototypeOf(a, Other.prototype);
  },
  frozen(a) {
    Object.freeze(a);
  },
  length(a) {
    a.length = 1;
  },
};

function twice(change) {
  const a = [1, 2, 3, 4];
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i];
  change(a);
  let text = "";
  for (let i = 0; i < a.length; i++) text += a[i] + ",";
  try {
    for (const x of a) text += x + ";";
  } catch (error) {
    text += error.constructor.name;
  }
  return sum + " " + text;
}

function inLine(list) {
  const a = list.map(x => x * 2);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i];
  for (let i = 0; i < a.length; i++) sum += a[i] * i;
  for (let turn = 0; turn < 3; turn++) {
    for (let i = 0; i < a.length; i++) sum += a[i];
    if (turn === 1) a[0] = 1.5;
  }
  return sum;
}

for (let round = 0; round < 3; round++) {
  for (const [name, change] of Object.entries(changes)) console.log(name, twice(change));
  console.log(inLine([1, 2, 3]), inLine([]), inLine([0.5, 1.5]));
}
console.log(seen);
