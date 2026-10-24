const show = object => Reflect.ownKeys(object).map(key => String(key) + "=" + JSON.stringify(object[key])).join(",");
const errorLines = error => [...String(error.stack).matchAll(/multi-spread-literals\.js:(\d+)/g)].map(match => match[1]).join(",");

const first = { a: 1, b: 2 };
const second = { b: 3, c: 4 };
const third = { c: 5, d: 6 };
const fourth = { e: 7 };
const fifth = { a: 8, f: 9 };

for (let round = 0; round < 3; round++) {
  console.log("two", show({ before: 0, ...first, between: 1, ...second, after: 2 }));
  console.log("three", show({ ...first, x: 1, ...second, y: 2, ...third }));
  console.log("five", show({ ...first, ...second, x: 1, ...third, ...fourth, y: 2, ...fifth }));
  console.log("later named wins", show({ ...first, ...second, a: "named", c: "named" }));
  console.log("later source wins", show({ a: "named", c: "named", ...first, ...second }));
  console.log("nullish sources", show({ ...null, a: 1, ...undefined, ...second, ...0 }));
  console.log("index names", show({ ...first, 1: "one", ...second, 0: "zero" }));
  console.log("string source", show({ ...first, ..."hi", ...second }));
  console.log("symbol source", show({ ...first, ...{ [Symbol.for("multi")]: 1 }, ...second }));
}

const throwing = {
  get boom() {
    throw new Error("boom");
  },
};

function spreadThrows() {
  return {
    ...first,
    named: 1,
    ...second,
    ...throwing,
    ...third,
  };
}

for (let round = 0; round < 2; round++) {
  try {
    spreadThrows();
  } catch (error) {
    console.log(error.message, errorLines(error));
  }
}

const order = [];
const logged = name => ({
  get [name]() {
    order.push(name);
    return name;
  },
});
console.log("getters", show({ ...logged("p"), q: order.push("named"), ...logged("r") }), order.join(","));

const changing = [{ a: 1 }, { b: 2 }, { a: 3, b: 4 }, { b: 5, a: 6 }, Object.create({ inherited: 1 }), [7, 8], null, "s", { get a() { return 9; } }];
for (let round = 0; round < 2; round++) {
  for (const left of changing) {
    for (const right of changing) console.log("changing", show({ ...left, mid: 0, ...right }));
  }
}
