class Keep {
  constructor(kept) {
    return kept;
  }
}
class Stamp extends Keep {
  #mark = 1;
  static isOn(kept) {
    return #mark in kept;
  }
}
function count(table, word) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  for (let k = 0; k < 300; k++) table.set(word, (table.get(word) ?? 0) + work);
  return table.get(word);
}
const table = new Map();
console.log(count(table, "a"));
new Stamp(table);
console.log(count(table, "a"), Stamp.isOn(table));
