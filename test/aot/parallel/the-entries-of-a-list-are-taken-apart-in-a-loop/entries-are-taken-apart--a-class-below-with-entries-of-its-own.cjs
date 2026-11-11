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
      (() => {
        class L extends Array {
          *entries() {
            yield [5, "five"];
          }
          *keys() {
            yield 6;
          }
          *values() {
            yield 7;
          }
        }
        return L.from([1, 2, 3]);
      })(),
      [],
    ).join();
  } catch (e) {
    said = "throws " + e.constructor.name;
  }
  if (t === 0 || t === n - 1) console.log(said);
}
