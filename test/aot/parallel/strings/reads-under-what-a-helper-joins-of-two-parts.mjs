// A small helper joins a text of two parts, and the read under what it gives goes by the parts, without the key being made. The parts make the keys that are no plain names:
// "length" of a list, "__proto__", texts that are places of a list, names that are not there.
const tails = ["gth", "to__", "1", "x", "0"];
const n = i => "n" + i, one = i => "1" + i, len = t => "len" + t, pro = t => "__pro" + t;
const record = { n0: "a", n2: "c", lenx: "L", len1: 7 }, list = [];
for (let i = 0; i < 13; i++) list.push(i * 2);
function run() { const said = [];
  for (let i = 0; i < 4; i++) said.push(record[n(i)], list[one(i)]);
  for (let j = 0; j < 6; j++) said.push(list[len(tails[j])], record[len(tails[j])], record[pro(tails[j])] === Object.prototype);
  return said.map(String).join(" "); }
console.log("SAID " + run());
