"use strict";
const key = JSON.parse('"g"');
const T = {
  g(x, out) {
    for (const [i, v] of x.entries()) out.push(String(i) + ":" + String(v));
    return out;
  },
};
const n = 6;
for (let t = 0; t < n; t++) {
  let said;
  try {
    said = T[key](
      Object.assign([1, 2, 3], {
        *entries() {
          yield [10, "x"];
          yield [20, "y"];
        },
        *keys() {
          yield 70;
        },
        *values() {
          yield 80;
        },
      }),
      [],
    ).join();
  } catch (e) {
    said = "throws " + e.constructor.name;
  }
  if (t === 0 || t === n - 1) console.log(said);
}
