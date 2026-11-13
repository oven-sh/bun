// A text that is no atom is searched among atoms, an atom among texts that are none, of the same length and spelled the same or not.
const table = {}; for (const k of ["alpha1", "beta22", "gamma3", "delta4", "alpha2"]) table[k] = 1;
const keys = Object.keys(table), texts = keys.map(k => Buffer.from(k).toString("latin1")), wide = keys.map(k => JSON.parse('"' + k + '中"').slice(0, 6));
const flat = s => { let sum = 0; for (let k = 0; k < s.length; k++) sum += s.charCodeAt(k); JSON.stringify(s); return s; };
for (const s of wide) flat(s);
const asked = [...keys, ...texts, ...wide, flat(Buffer.from("alpha3").toString("latin1")), "alphaX".toLowerCase(), "ALPHA1".toLowerCase(), flat(JSON.parse('"gamm' + 'a3"'))];
function seek(list, value) { return list.indexOf(value) + (list.includes(value) ? 10 : 20); }
function seekField(o, value) { return o.list.indexOf(value); }
const lists = [keys, texts, wide, [...keys, ...texts], [...texts, ...keys].reverse(), keys.slice(2)], o = { list: keys };
for (let round = 0; round < 4; round++) {
  const lines = [];
  for (const list of lists) { o.list = list; lines.push(asked.map(value => seek(list, value) + "/" + seekField(o, value)).join()); }
  lines.push(asked.map(value => keys.indexOf(value)).join(), asked.map(value => texts.indexOf(value)).join(), asked.map(value => wide.includes(value) ? 1 : 0).join(), asked.map(value => keys.lastIndexOf(value)).join());
  console.log(lines.join("\n"));
}
let found = 0; for (let i = 0; i < 400; i++) { const value = asked[i % asked.length]; found = (found * 31 + keys.indexOf(value) + texts.indexOf(value) * 3) | 0; } console.log(found);
for (let i = 0; i < 12; i++) console.log(keys.indexOf(flat(texts[i % 5])), texts.indexOf(flat(keys[i % 5])), keys.includes(flat(texts[i % 5])), keys.indexOf(flat("alpha" + i)), texts.includes(flat("gamma" + i)));
function places(list) { const out = []; for (let i = 0; i < 12; i++) out.push(keys.indexOf(flat(list[i % list.length])), keys.includes(flat(list[(i + 1) % list.length]))); return out.join(); }
console.log(places(texts), places(keys), places(wide), places(["alpha1", "x", "", "beta22"]));
const first = Buffer.from("alpha1").toString("latin1"), second = Buffer.from("gamma3").toString("latin1"), none = Buffer.from("gamma4").toString("latin1");
for (let i = 0; i < 3; i++) console.log(keys.indexOf(flat(first)), keys.indexOf(flat(second)), keys.indexOf(flat(none)), keys.includes(flat(second)), keys.indexOf(first));
