// STATISTIC: Int32SpeculationsWithNumberFallback >= 1
let asked = 0;
const hidden = JSON.parse('["7", "7.5", "x", "", " 12 ", "0x10", null, true, false, [], [5.5], {}, 0, 0, 0, 0, 0]');
hidden[12] = undefined;
hidden[13] = { valueOf() { asked = asked + 1; return 6.5 + asked; } };
hidden[14] = { toString() { asked = asked + 10; return "9.75"; } };
hidden[15] = 3n;
hidden[16] = Symbol("s");
function mix(h, k) {
  h ^= k;
  return (h << 3) | (h >>> 29);
}
function go(t, m) {
  let h = t | 0;
  for (let i = 0; i < 20; i++) h = mix(h, m);
  return h;
}
const said = [];
for (let n = 0; n < hidden.length; n++) {
  try {
    said.push(go(3, hidden[n]));
  } catch (e) {
    said.push(e.constructor.name);
  }
}
console.log(said.join(), asked);
