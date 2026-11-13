"use strict";

// Any text is searched for in lists of any length: holes, numbers, atoms and texts that are none, ropes, parts of other texts, single letters, wide texts, names that were keys before.
const hide = (value) => [value][JSON.parse("0")];
const letters = "abcdefghijklmnopqrstuvwxyz";
const source = "key0 key1 key2 key10 key11 longerkey12 anotherlongkey13 sixteenletters16 seventeenletters_ a b ab été key3";
const parts = source.split(" ");
const table = {};
for (let i = 0; i < 80; i++) table["key" + i] = i;
let lookups = 0;
// Parts of a text that are looked up by name are remembered as names.
function rememberNames() {
  for (let round = 0; round < 4; round++) {
    for (const part of (source + " " + round).split(" ")) lookups += table[part] | 0;
  }
}

const makers = {
  atom: (i) => Object.keys({ ["key" + i]: 1 })[0],
  flat: (i) => ["k", "e", "y", i].join(""),
  part: (i) => ("xx" + "key" + i + "yy").slice(2, -2),
  rope: (i) => hide("key") + hide(String(i)),
  number: (i) => i,
  fraction: (i) => i + 0.5,
  wide: (i) => ("Ākey" + i).slice(1),
  letter: (i) => letters[i % 26],
  madeLetter: (i) => ["", letters[i % 26]].join(""),
  long: (i) => "longerkey" + i + "_".repeat(i % 9),
  empty: () => "",
  object: () => ({}),
  nothing: (i) => [undefined, null, NaN, true, 7n][i % 5],
};
const kinds = Object.keys(makers);
function makeList(length, seed) {
  const list = [];
  for (let i = 0; i < length; i++) {
    const kind = kinds[(i * 7 + seed * 5 + (i >> 2)) % (seed % 3 ? 4 : kinds.length)];
    list.push(makers[kind]((i * 3 + seed) % 80));
  }
  return list;
}
const soughts = () => {
  const found = parts.slice();
  for (const kind of kinds) for (const i of [0, 1, 3, 12, 25, 33, 64]) found.push(makers[kind](i));
  found.push(source.slice(0, 4), source.slice(5, 9), source.slice(0, 1), source.slice(1, 1), hide("key") + hide("1"), letters[4], new String("key1"), Symbol("key1"));
  return found;
};

const viaName = (list, text, name) => list[name](text);
function ask(list, texts) {
  let sum = 0;
  let places = "";
  for (const text of texts) {
    const place = hide(list).indexOf(text);
    const isIncluded = hide(list).includes(text);
    sum = (sum * 31 + place * 2 + (isIncluded ? 1 : 0)) | 0;
    if (place !== viaName(list, text, "indexOf") || isIncluded !== viaName(list, text, "includes")) places += "!";
    let byHand = -1;
    for (let i = 0; i < list.length; i++) {
      if (i in list && list[i] === text) {
        byHand = i;
        break;
      }
    }
    if (byHand !== place) places += "?" + byHand + ":" + place;
  }
  return sum + places;
}
const once = (list, text) => list.indexOf(text);

const row = [];
for (let round = 0; round < 3; round++) {
  if (round) rememberNames();
  for (const length of [0, 1, 2, 3, 7, 8, 9, 15, 16, 17, 31, 32, 33, 63, 64, 65, 70, 200]) {
    for (let seed = 0; seed < 4; seed++) {
      const list = makeList(length, seed + round);
      row.push(ask(list, soughts()));
      if (length > 4) {
        delete list[1];
        delete list[length - 2];
        row.push(ask(list, soughts()));
        list.length = length - 1;
        list[length + 3] = "key1";
        row.push(ask(list, soughts()));
      }
    }
  }
  if (globalThis.gc) gc();
  console.log(round, row.length, row.join());
  row.length = 0;
}
// One kind of list alone.
for (const kind of kinds) {
  for (const length of [1, 8, 33, 65]) {
    const list = [];
    for (let i = 0; i < length; i++) list.push(makers[kind](i));
    row.push(ask(list, soughts()), once(list, "key7"), once(list, list[length - 1]), once(list, list[0]));
  }
}
console.log(row.join(), lookups);
// A list that the search meets frozen, below another class, with members of its own.
const frozen = Object.freeze(makeList(20, 1));
class Heir extends Array {}
const heir = Heir.from(makeList(20, 2));
const named = Object.assign(makeList(20, 3), { name: "own" });
console.log(ask(frozen, soughts()), ask(heir, soughts()), ask(named, soughts()));
