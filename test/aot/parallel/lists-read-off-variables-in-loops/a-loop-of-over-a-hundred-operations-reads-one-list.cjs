"use strict";
function mix(d) { let h = 7; for (let i = 0; i < d.length; i++) { h = (h * 3 + d[i]) & 65535; h = (h ^ d[i]) + 1; h = (h * 3 + d[i]) & 65535; h = (h ^ d[i]) + 1; h = (h * 3 + d[i]) & 65535; h = (h ^ d[i]) + 1; h = (h * 3 + d[i]) & 65535; h = (h ^ d[i]) + 1; h = (h * 3 + d[i]) & 65535; h = (h ^ d[i]) + 1; h = (h * 3 + d[i]) & 65535; h = (h ^ d[i]) + 1; h = (h * 3 + d[i]) & 65535; h = (h ^ d[i]) + 1; h = (h * 3 + d[i]) & 65535; h = (h ^ d[i]) + 1; h = (h * 3 + d[i]) & 65535; h = (h ^ d[i]) + 1; h = (h * 3 + d[i]) & 65535; h = (h ^ d[i]) + 1; h = (h * 3 + d[i]) & 65535; h = (h ^ d[i]) + 1; h = (h * 3 + d[i]) & 65535; h = (h ^ d[i]) + 1; } return h; }
const said = [];
for (const d of [JSON.parse(process.argv[2] ?? "[1,2,3,4,5]"), [1.5, 2.5], [1, , 3], ["1", 2], [1, { valueOf() { said.push("asked"); return 2; } }], new Uint8Array([250, 251]), Buffer.from([1, 2, 3]), new Float64Array([0.5, 1.5]), "123", { length: 2, 0: 4, 1: 5 }, [], [1n], null]) {
  try { said.push(String(mix(d))); } catch (error) { said.push(error.name); }
}
console.log("SAID", said.join(" "));
