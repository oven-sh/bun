// STATISTIC: ArraysGuardedInIterations >= 2
const steps = JSON.parse(`["run"]`);
const ops = { run, join };
function call(d, t) {
  return ops[steps[0]](d, t);
}
function run(d, t) {
  let sum = 0;
  for (let i = 0; i < d.length; i++) sum += d[i][0] * d[i][1];
  return sum + t;
}
function join(d, t) {
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    const x = d[i][0],
      y = d[i][1];
    sum += x;
    sum += y;
  }
  return sum + "|" + t;
}

class Row extends Array {}

class Padded extends Array {}
Padded.prototype[1] = 7;
const padded = new Padded(2);
padded[0] = 1.5;
const above = [2.5, , 1];
Object.setPrototypeOf(above, { __proto__: Array.prototype, 1: 9 });
let readsAbove = 0;
const asked = [3.5, , 1];
Object.setPrototypeOf(
  asked,
  Object.create(Array.prototype, {
    1: {
      get() {
        readsAbove++;
        return 11;
      },
    },
  }),
);
function asArguments(...values) {
  return (function () {
    return arguments;
  })(...values);
}
const tagged = [2.5, 4];
tagged.tag = "x";
let trapped = 0;
const kinds = {
  views: [new Float64Array([1.5, 2]), new Int8Array([3, 4])],
  texts: ["12", "34"],
  records: [
    { 0: 1.5, 1: 2 },
    { 0: 3, 1: 4 },
  ],
  subclass: [Row.from([1.5, 2]), Row.of(3, 4)],
  holesBelowAnIndexOfTheClass: [padded, [1, 2]],
  holesBelowAnIndexLaidAbove: [above, [1, 2]],
  holesBelowAGetterLaidAbove: [asked, [1, 2]],
  argumentsObjects: [asArguments(1.5, 2), asArguments(3, 4)],
  frozen: [Object.freeze([1.5, 2]), Object.seal([3, 4])],
  tagged: [tagged, [1, 2]],
  proxies: [
    new Proxy([1.5, 2], {
      get(target, key, receiver) {
        trapped++;
        return Reflect.get(target, key, receiver);
      },
    }),
    [3, 4],
  ],
  ofTexts: [
    ["a", "b"],
    ["c", 2],
  ],
  ofBigInts: [
    [2n, 3n],
    [4n, 5n],
  ],
  ofObjects: [
    [{ valueOf: () => 3 }, 2],
    [1, { valueOf: () => 5 }],
  ],
  mixedKinds: [
    [1, 2],
    [1.5, 2.5],
    [1, "2"],
    [true, null],
    [undefined, 1],
  ],
  special: [
    [-0, 1],
    [NaN, 1],
    [1 / 0, 0],
    [-1 / 0, -0],
    [2147483647, 2],
    [-2147483648, 2],
  ],
  nothing: [[1, 2], null],
  numbers: [1, 2],
};
const said = [];
for (const step of ["run", "join"]) {
  steps[0] = step;
  for (const name in kinds) {
    for (let t = 0; t < 2; t++) {
      try {
        said.push(step + " " + name + " " + String(call(kinds[name], t)));
      } catch (error) {
        said.push(step + " " + name + " " + error.constructor.name);
      }
    }
  }
}
console.log(
  said.join(`
`),
  trapped,
  readsAbove,
);
