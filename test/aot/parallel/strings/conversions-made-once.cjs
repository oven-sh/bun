// toLowerCase(), toUpperCase() and trim() of one string, done once or again, with changes between, and the lookups of a class that wraps a Map.
const out = [];
class Caseless {
  constructor(other) { this.map = other ? new Map(other.map) : new Map(); }
  set(key, value) { this.map.set(key.toLowerCase(), value); return this; }
  has(key) { return this.map.has(key.toLowerCase()); }
  get(key) { return this.map.get(key.toLowerCase()); }
  delete(key) { return this.map.delete(key.trim().toLowerCase()); }
}
const names = ["Alpha", "BETA", "gamma", "x", "Y", " z ", "ÄÖ", "ß", "İ", ""].map((text, k) => (text + "|" + k).split("|")[0]);
function count(map, list) {
  let found = 0;
  for (let i = 0; i < list.length; i++) {
    const name = list[i];
    if (map.has(name)) found += map.get(name); else map.set(name, i + 1);
  }
  return found;
}
function between(map, list, change) {
  const answers = [];
  for (let i = 0; i < list.length; i++) {
    const name = list[i];
    if (map.has(name)) { change(map, name, i); answers.push(map.get(name)); } else { map.set(name, "new " + i); answers.push(map.has(name)); }
  }
  return answers.join();
}
function cases(list) {
  const answers = [];
  for (let i = 0; i < list.length; i++) {
    let text = list[i];
    const low = text.toLowerCase(), up = text.toUpperCase();
    answers.push(low === text.toLowerCase(), up === text.toUpperCase(), low + up, text.trim() + "." + text.trimStart() + "." + text.trimEnd() + "." + text.trim());
    if (i & 1) text = text + "Q";
    answers.push(text.toLowerCase(), text.toUpperCase().toLowerCase(), text.toLowerCase().toUpperCase());
  }
  return answers.join("/");
}
const map = new Caseless();
for (let turn = 0; turn < 4; turn++) out.push(count(map, names));
for (const change of [() => {}, (m, name) => m.delete(name), (m, name, i) => m.set(name, "set " + i), m => m.map.clear(), m => { for (let k = 0; k < 40; k++) m.set("G" + k, k); }, m => { m.map = new Map(); }, (m, name) => { m.map = new Map([[name.toLowerCase(), "other"]]); }])
  for (let turn = 0; turn < 2; turn++) out.push(between(new Caseless(map), names, change), between(map, names, change));
out.push(cases(names));
const convert = String.prototype.toLowerCase;
const odd = [...names, { toLowerCase: () => "own", trim: () => "t" }];
let odds = 0;
for (let i = 0; i < odd.length; i++) { const key = odd[i]; odds += key.toLowerCase().length + key.toLowerCase().length; }
out.push(odds, convert.call("ABC"));
console.log(out.join("\n"));
