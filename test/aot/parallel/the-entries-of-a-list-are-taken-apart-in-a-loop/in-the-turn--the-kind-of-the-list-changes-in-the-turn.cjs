"use strict";
const key = JSON.parse('"g"');
const T = {
  g(x, out) {
    for (const [i, v] of x.entries()) {
      if (i === 0)
        x[2] = {
          toString() {
            return "obj";
          },
        };
      out.push(i + ":" + v);
    }
    return out;
  },
};
const n = 6;
for (let t = 0; t < n; t++) {
  let said;
  try {
    said = T[key]([1.5, 2.5, 3.5, 4.5], []).join();
  } catch (e) {
    said = "throws " + e.constructor.name;
  }
  if (t === 0 || t === n - 1) console.log(said);
}
