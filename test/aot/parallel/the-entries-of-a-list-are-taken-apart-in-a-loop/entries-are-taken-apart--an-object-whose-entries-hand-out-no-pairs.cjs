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
      {
        *entries() {
          yield "xy";
          yield [1];
          yield new Set([8, 9]);
        },
        *keys() {
          yield "k";
        },
        *values() {
          yield "v";
        },
      },
      [],
    ).join();
  } catch (e) {
    said = "throws " + e.constructor.name;
  }
  if (t === 0 || t === n - 1) console.log(said);
}
