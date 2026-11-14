const parts = ["", "a", "Zz3", "\u00e9\u00ff", "\u0101\ud83d\ude00"];
const make = [
  (x, y, z) => x + y,
  (x, y, z) => x + y + z,
  (x, y, z) => `${x}${y}`,
  (x, y, z) => (x + y) + (z + x),
  (x, y, z) => (x + y).slice(1) + z,
  (x, y, z) => (x + y + z).slice(1, -1),
  (x, y, z) => ("<" + x + y + z + ">").substring(1, 20),
  (x, y, z) => x.slice(0, 3) + y.slice(1),
];
const takes = [
  (text, at) => text.substr(at, 1), (text, at) => text.slice(at, at + 1), (text, at) => text.substring(at, at + 1), (text, at) => text.substr(at, 1).toUpperCase(), (text, at) => text.substr(at, 1).toLowerCase(),
  (text, at) => text.substr(-1 - at, 1), (text, at) => text.slice(at).slice(0, 1), (text, at) => text.substr(at, 2).substr(1, 1),
];
let out = "", wrong = 0;
for (const x of parts) for (const y of parts) for (const z of parts) for (let m = 0; m < make.length; m++) {
  let sum = 0;
  const flat = [...make[m](x, y, z)].join(""), length = make[m](x, y, z).length;
  for (let t = 0; t < takes.length; t++) for (let at = 0; at <= length; at++) {
    const got = takes[t](make[m](x, y, z), at);
    if (got !== takes[t](flat.split("").join(""), at)) wrong++;
    for (let i = 0; i < got.length; i++) sum = (sum * 31 + got.charCodeAt(i) + at) % 1000003;
  }
  out += sum + " ";
}
let hash = 0;
for (let i = 0; i < out.length; i++) hash = (hash * 33 + out.charCodeAt(i)) >>> 0;
console.log(wrong, hash, out.length);
const cards = [];
for (const suit of ["c", "d"]) for (const value of ["2", "T", "A"]) cards.push(value + suit);
let seen = "";
for (let turn = 0; turn < 40; turn++) for (const card of cards) seen = card.substr(0, 1).toLowerCase() + card.substr(1, 1).toUpperCase() + seen.slice(0, 9);
console.log(seen, seen === [...seen].join(""), cards.join());
