// `sum = (sum + object.a * object.b - object.c) | 0` over literals, spreads and assigned objects whose fields hold small integers, two of each kind in turn.
// twins.cjs writes literals with the same names that hold fractions, texts and integers it computes; the names p, q and r are written here alone.
// COUNT: operations <= 100
// COUNT: arrivals <= 50
// COUNT: cells <= 100
// COUNT: branches <= 225500
const twins = require("./twins.cjs");
const loops = {};

const defaultsPQR = { p: 1, q: 2 };
const spreadPQR = options => ({ ...defaultsPQR, ...options });
const assignPQR = options => Object.assign({}, defaultsPQR, options);
const writtenPQR = [
  { p: 1, q: 2, r: 3 },
  { p: 2, q: 3, r: 4 },
];
const spreadsPQR = [spreadPQR({ r: 3 }), spreadPQR({ r: 4 })];
const assignedPQR = [assignPQR({ r: 3 }), assignPQR({ r: 4 })];
function productsOfPQR(objects, rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    const object = objects[round & 1];
    sum = (sum + object.p * object.q - object.r) | 0;
  }
  return sum;
}
loops["literals that no other file writes"] = rounds => productsOfPQR(writtenPQR, rounds);
loops["spreads that no other file writes"] = rounds => productsOfPQR(spreadsPQR, rounds);
loops["assigned objects that no other file writes"] = rounds => productsOfPQR(assignedPQR, rounds);

const defaultsABC = { a: 1, b: 2 };
const spreadABC = options => ({ ...defaultsABC, ...options });
const assignABC = options => Object.assign({}, defaultsABC, options);
const writtenABC = [
  { a: 1, b: 2, c: 3 },
  { a: 2, b: 3, c: 4 },
];
const spreadsABC = [spreadABC({ c: 3 }), spreadABC({ c: 4 })];
const assignedABC = [assignABC({ c: 3 }), assignABC({ c: 4 })];
function productsOfABC(objects, rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    const object = objects[round & 1];
    sum = (sum + object.a * object.b - object.c) | 0;
  }
  return sum;
}
loops["literals beside fractions"] = rounds => productsOfABC(writtenABC, rounds);
loops["spreads beside fractions"] = rounds => productsOfABC(spreadsABC, rounds);
loops["assigned objects beside fractions"] = rounds => productsOfABC(assignedABC, rounds);

const defaultsDEF = { d: 1, e: 2 };
const spreadDEF = options => ({ ...defaultsDEF, ...options });
const assignDEF = options => Object.assign({}, defaultsDEF, options);
const writtenDEF = [
  { d: 1, e: 2, f: 3 },
  { d: 2, e: 3, f: 4 },
];
const spreadsDEF = [spreadDEF({ f: 3 }), spreadDEF({ f: 4 })];
const assignedDEF = [assignDEF({ f: 3 }), assignDEF({ f: 4 })];
function productsOfDEF(objects, rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    const object = objects[round & 1];
    sum = (sum + object.d * object.e - object.f) | 0;
  }
  return sum;
}
loops["literals beside texts"] = rounds => productsOfDEF(writtenDEF, rounds);
loops["spreads beside texts"] = rounds => productsOfDEF(spreadsDEF, rounds);
loops["assigned objects beside texts"] = rounds => productsOfDEF(assignedDEF, rounds);

const defaultsGHI = { g: 1, h: 2 };
const spreadGHI = options => ({ ...defaultsGHI, ...options });
const assignGHI = options => Object.assign({}, defaultsGHI, options);
const writtenGHI = [
  { g: 1, h: 2, i: 3 },
  { g: 2, h: 3, i: 4 },
];
const spreadsGHI = [spreadGHI({ i: 3 }), spreadGHI({ i: 4 })];
const assignedGHI = [assignGHI({ i: 3 }), assignGHI({ i: 4 })];
function productsOfGHI(objects, rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    const object = objects[round & 1];
    sum = (sum + object.g * object.h - object.i) | 0;
  }
  return sum;
}
loops["literals beside computed integers"] = rounds => productsOfGHI(writtenGHI, rounds);
loops["spreads beside computed integers"] = rounds => productsOfGHI(spreadsGHI, rounds);
loops["assigned objects beside computed integers"] = rounds => productsOfGHI(assignedGHI, rounds);

console.log(
  twins.halves(3).b,
  twins.halvesOfThree(3).b,
  twins.labels(3).e,
  twins.labelsOfThree(3).e,
  twins.neighbors(3).h,
  twins.neighborsOfThree(3).i,
);
for (const name in loops) console.log(name, loops[name](5000));
const [loop = "", turns = "5000"] = process.argv.slice(2);
if (loop in loops) console.log(loops[loop](Number(turns)));
