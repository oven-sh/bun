// Own-property questions about literals of few names, under keys out of arrays.
const symbol = Symbol("a");
const keyLists = {
  names: ["a", "b", "c"],
  absent: ["x", "a", "toString"],
  odd: ["__proto__", "constructor", "hasOwnProperty", ""],
  ropes: ["a" + "", "ab".slice(0, 1), "xa".slice(1), String.fromCharCode(98)],
  elements: ["0", "1", "-0", "a"],
  mixed: [0, "a", undefined, null, symbol, "b"],
};
const constant = { a: 1, b: 2 };
const single = { a: undefined };
const four = { a: 1, b: 2, c: 3, d: 4 };
const bare = { __proto__: null, a: 1, b: 2 };
const getters = { get a() { throw new Error("not asked"); }, b: 1 };
const frozen = Object.freeze({ a: 1, b: 2 });
const numbered = { 0: 1, a: 2 };
const gains = { a: 1, b: 2 };
const loses = { a: 1, b: 2 };
const computed = { a: 1, b: 2 };
const left = { a: 1, b: 2 };
globalThis.left = left;
function count(keys, ask) {
  let n = "";
  for (let k = 0; k < 12; k++) n += ask(keys[k % keys.length]) ? 1 : 0;
  return n;
}
for (const [name, keys] of Object.entries(keyLists)) {
  let n = 0, s = "";
  for (let k = 0; k < 12; k++) n += constant.hasOwnProperty(keys[k % keys.length]) ? 1 : 0;
  for (let k = 0; k < 12; k++) if (Object.hasOwn(single, keys[k % keys.length])) s += "s" + k;
  for (let k = 0; k < 12; k++) s += four.hasOwnProperty(keys[k % keys.length]) ? "f" : "-";
  for (let k = 0; k < 12; k++) s += Object.hasOwn(bare, keys[k % keys.length]) ? "b" : "-";
  for (let k = 0; k < 12; k++) s += getters.hasOwnProperty(keys[k % keys.length]) ? "g" : "-";
  for (let k = 0; k < 12; k++) s += frozen.hasOwnProperty(keys[k % keys.length]) ? "z" : "-";
  for (let k = 0; k < 12; k++) s += Object.prototype.hasOwnProperty.call(numbered, keys[k % keys.length]) ? "n" : "-";
  for (let k = 0; k < 12; k++) {
    s += gains.hasOwnProperty(keys[k % keys.length]) ? "+" : "-";
    if (k === 5 && name === "absent") gains.x = 1;
  }
  for (let k = 0; k < 12; k++) {
    s += loses.hasOwnProperty(keys[k % keys.length]) ? "+" : "-";
    if (k === 5) delete loses.b;
  }
  for (let k = 0; k < 12; k++) {
    s += computed.hasOwnProperty(keys[k % keys.length]) ? "+" : "-";
    if (k === 5 && name !== "odd") computed[keys[1]] = 1;
  }
  for (let k = 0; k < 12; k++) s += left.hasOwnProperty(keys[k % keys.length]) ? "l" : "-";
  console.log(name, n, s, count(keys, key => constant.hasOwnProperty(key)), count(keys, key => Object.hasOwn(four, key)));
}
let asked = 0;
const asksOnce = { toString() { asked++; return "a"; } };
for (let k = 0; k < 5; k++) if (constant.hasOwnProperty(asksOnce)) asked += 10;
console.log(asked);
