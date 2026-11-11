"use strict";
const key = JSON.parse('"g"');
const T = {
  g(x, out) {
    for (const [i, v] of x.entries()) out.push(String(i) + ":" + String(v));
    return out;
  },
};
class Below extends Array {}
Below.prototype[JSON.parse('"entries"')] = function* () { yield [7, "z"]; };
const n = 6;
for (let t = 0; t < n; t++) {
  let said;
  try {
    said = T[key](Below.from([1, 2]), []).join();
  } catch (e) {
    said = "throws " + e.constructor.name;
  }
  if (t === 0 || t === n - 1) for (const word of String(said).split(",")) console.log("SAID", word);
}
