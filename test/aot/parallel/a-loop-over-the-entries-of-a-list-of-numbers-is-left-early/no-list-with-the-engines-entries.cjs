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
    said = T[key]({ length: 2, 0: "a", 1: "b", [JSON.parse('"entries"')]: [][JSON.parse('"entries"')] }, []).join();
  } catch (e) {
    said = "throws " + e.constructor.name;
  }
  if (t === 0 || t === n - 1) for (const word of String(said).split(",")) console.log("SAID", word);
}
