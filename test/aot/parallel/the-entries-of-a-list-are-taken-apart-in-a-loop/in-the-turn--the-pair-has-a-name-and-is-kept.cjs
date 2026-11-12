"use strict";
const key = JSON.parse('"g"');
const T = {
  g(x, out) {
    const kept = [];
    for (const e of x.entries()) {
      const [i, v] = e;
      kept.push(e);
      out.push(i + ":" + v);
    }
    out.push(kept.length, Array.isArray(kept[0]), kept[0].length, kept[0] === kept[1]);
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
