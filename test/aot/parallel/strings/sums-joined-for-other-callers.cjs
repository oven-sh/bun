// Under: --aot-harden=proof-checks: where a test shows strings the sum is joined, which may throw; the callers pass numbers alone, so Link says that the function does not, and the build stopped
const objects = [
  { f(x, y, z) {} },
  {
    f(x, y, z) {
      for (let i = 0; i < 3; i++) y = y + (2 + y);
      let kept = z;
      for (let i = 0; i < 3; i++) y = y + (z + kept);
      let bits = (1 - y) | (kept & y);
    },
  },
];
function run() {
  let value = -2147483648;
  let calls = 0;
  for (let i = 0; i < 20; i++) {
    try {
      value = objects[1].f(value, value, value);
      calls++;
    } catch (error) {
      console.log(error.name);
    }
  }
  return calls;
}
console.log(run());

const others = [
  {
    g(y, z) {
      for (let i = 0; i < 3; i++) y = y + (2 + y);
      for (let i = 0; i < 3; i++) y = y + (z + z);
      return typeof y === "string" ? y.length + y.slice(0, 12) : y;
    },
  },
];
let long = "x";
for (let i = 0; i < 29; i++) long += long;
for (const value of [1, "a", undefined, 0.5, long, null]) {
  for (const other of [1, "b"]) {
    let behind = 0;
    try {
      behind = 1;
      const result = others[0].g(value, other);
      behind = 2;
      console.log(String(result), behind);
    } catch (error) {
      console.log(error.name, behind);
    }
  }
}
