"use strict";
const key = JSON.parse('"g"');
const T = {
  g(x, out) {
    const later = [];
    for (const [i, v] of x.entries()) later.push(() => i + ":" + v);
    for (const f of later) out.push(f());
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
