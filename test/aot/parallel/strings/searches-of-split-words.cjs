// Searches of lists of words split out of literals: words of all lengths, duplicates, flat and rope and 16-bit strings, lists that are stored to afterwards.
"use strict";
const wide = "一";
function forms(k) {
  const padded = "(" + k + ")" + wide, narrow = "<<" + k + ">>", half = k.length >> 1, o = {};
  o[k] = 1;
  return [k, padded.slice(1, 1 + k.length), narrow.slice(2, 2 + k.length), k.slice(0, half) + k.slice(half), [...k].join(""), Object.keys(o)[0], (k + "z").slice(0, -1)];
}
function make(words, separator) {
  words = words.split(separator);
  return { words, find: (s) => words.indexOf(s), has: (s) => words.includes(s), last: (s) => words.lastIndexOf(s), from: (s) => words.indexOf(s, 2) };
}
function slow(list, s, start = 0) { for (let i = start; i < list.length; i++) if (list[i] === s) return i; return -1; }
function slowLast(list, s) { for (let i = list.length - 1; i >= 0; i--) if (list[i] === s) return i; return -1; }
const lists = [
  make("break case catch continue debugger default do else finally for function if return switch throw try var while with null true false instanceof typeof void delete new in this let const class extends export import yield super", " "),
  make("a b c d e f g h i j k l m n o p q r s t u v w x y z", " "),
  make("ab ba aa bb ab ba aa bb ab", " "),
  make("implements interface let package private protected public static yield", " "),
  make("abcdefgh abcdefgi bbcdefgh abcdefghi abcdefghj abcdefgh1234567 abcdefgh1234568 abcdefgh12345678 abcdefgh12345679", " "),
  make("aé aè éa aéb aèb añ añb aé1", " "),
  make("xx||xy||yx||yy||xxx||xyx||xxy||yxx", "||"),
  make("seven words are not enough for it", " "),
  make(" starts with no word at all here", " "),
];
let more = "w0";
for (let i = 1; i < 99; i++) more += " w" + i;
lists.push(make(more, " "), make(more + " w99", " "));
const out = [];
let bad = 0;
function check(list, key) {
  let sum = 0;
  for (const s of forms(key)) {
    const at = list.find(s);
    if (at !== slow(list.words, s) || list.has(s) !== at >= 0 || list.last(s) !== slowLast(list.words, s) || list.from(s) !== slow(list.words, s, 2)) bad++;
    sum = (sum * 31 + at + 2) | 0;
  }
  return sum;
}
const keys = new Set([""]);
for (const list of lists) for (const w of list.words.slice(0, 12)) for (const k of [w, w + "x", w.slice(1), w.slice(0, -1), w.toUpperCase(), [...w].reverse().join("")]) keys.add(k);
for (const list of lists) {
  let sum = 0;
  for (const k of keys) sum = (sum * 33 + check(list, k)) | 0;
  out.push(list.words.length + " " + sum + " " + [3, undefined, null, {}, true, Symbol.iterator].map((v) => list.find(v)));
}
lists[0].words.push("pushed");
lists[1].words.reverse();
lists[2].words[1] = "stored";
lists[3].words.length = 4;
lists[4].words.sort();
delete lists[5].words[0];
lists[6].words.unshift("first");
for (const list of lists) {
  let sum = 0;
  for (const k of [...keys, "pushed", "stored", "first"]) sum = (sum * 33 + check(list, k)) | 0;
  out.push(list.words.length + " " + sum + " " + JSON.stringify(list.words.slice(-2)) + list.words.concat(lists[7].words).length);
}
for (const line of out) console.log(line);
console.log(bad);
