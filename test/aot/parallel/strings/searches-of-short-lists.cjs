// Short lists of words are searched for atoms, substrings, concatenations, flat strings and wide strings.
"use strict";
const out = [];
const lists = {
  one: "enum".split(" "), two: "enum await".split(" "), seven: "implements interface let package private protected public".split(" "), nine: "implements interface let package private protected public static yield".split(" "),
  literal: ["a", "ab", "abc", "abcdefgh", "abcdefghi", "", "жук"], sixteen: "a b c d e f g h i j k l m n o pq".split(" "), seventeen: "a b c d e f g h i j k l m n o p qr".split(" "), comma: "eval,arguments".split(","),
};
const source = "enum await implements interface let package private protected public static yield a ab abc abcdefgh abcdefghi pq qr eval arguments é none en um";
const wide = source + " жук 一";
const find = (words, text) => words.indexOf(text);
const has = (words, text) => words.includes(text);
const behind = (words, text) => words.indexOf(text, 1);
for (const name of Object.keys(lists)) {
  const words = lists[name];
  let s = "";
  for (const text of [source, wide]) {
    let at = 0;
    while (at <= text.length) {
      let end = text.indexOf(" ", at);
      if (end < 0) end = text.length;
      const piece = text.slice(at, end);
      s += find(words, piece) + (has(words, piece) ? "y" : "n") + behind(words, piece) + " ";
      const joined = text.slice(at, at + 1) + text.slice(at + 1, end);
      s += find(words, joined) + (has(words, joined) ? "y" : "n") + " ";
      at = end + 1;
    }
  }
  const key = {};
  key[source.slice(0, 4)] = 1;
  for (const k in key) s += find(words, k);
  for (const other of ["", undefined, null, 4, {}]) s += find(words, other) + "," + has(words, other) + ";";
  out.push(name + " " + s);
}
for (const line of out) console.log(line);
