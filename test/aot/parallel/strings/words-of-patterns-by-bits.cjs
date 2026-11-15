// Words of patterns made at run time: every word, its neighbors by one character, and others of its length; narrow, wide, pieces, ropes. One character sought in pieces and whole strings.
"use strict";
const out = [];
const lists = ["break case catch continue debugger default do else finally for function if return switch throw try var while with null true false instanceof typeof void delete new in this const class extends export import super", "a b c", "enum", "implements interface let package private protected public static yield", "x".repeat(40) + " " + "y".repeat(41), "é ü ß ñandú", "Āb cā Āā ab", "await", Array.from({ length: 300 }, (_, k) => "word" + k).join(" "), "aa ab ba bb aaa aab aba abb baa bab bba bbb"];
const make = [(s) => s, (s) => ("<" + s + ">").slice(1, -1), (s) => s.split("").join(""), (s) => s.slice(0, s.length >> 1) + s.slice(s.length >> 1), (s) => (s + "Ā").slice(0, -1)];
let hits = 0, misses = 0;
for (const list of lists) {
  const words = list.split(" "), pattern = new RegExp("^(?:" + words.join("|") + ")$"), held = new Set(words);
  const others = ["", "a", "zz", "constructor", "__proto__", "identifier", "x".repeat(39), "x".repeat(42)];
  for (const word of words) { others.push(word + "s", word.slice(1), word.slice(0, -1), word.toUpperCase(), word[0] + "~".repeat(Math.max(0, word.length - 2)) + word[word.length - 1], [...word].reverse().join(""), word + word, " " + word, word + "\n"); }
  for (let round = 0; round < 3; round++) for (const subject of [...words, ...others]) {
    const string = make[(round + subject.length) % make.length](subject), answer = pattern.test(string);
    if (answer !== held.has(subject)) out.push("wrong " + list.slice(0, 20) + " " + subject + " " + answer);
    const match = pattern.exec(string); if ((match !== null) !== answer || (match && (match[0] !== subject || match.index !== 0))) out.push("wrong match " + subject);
    if (string.match(pattern) === null ? answer : !answer) out.push("wrong of string " + subject);
    answer ? hits++ : misses++;
  }
  out.push(list.slice(0, 10) + " " + hits + " " + misses + " " + pattern.lastIndex);
}
const all = new RegExp("^(?:" + lists[0].replace(/ /g, "|") + ")$");
for (const strange of [null, undefined, true, false, 1, {}, [], ["if"], Symbol.iterator, { toString() { return "if"; } }, 10n]) { let answer; try { answer = all.test(strange); } catch (error) { answer = error.constructor.name; } out.push(String(answer)); }
const index = (string, from) => from === undefined ? string.indexOf("\\") : string.indexOf("\\", from);
for (let length = 0; length < 70; length++) for (const at of [0, 1, length >> 1, length - 1, length, -1]) for (const form of make) {
  const plain = "q".repeat(length), string = at >= 0 && at < length ? plain.slice(0, at) + "\\" + plain.slice(at + 1) : plain;
  const made = form(string), expected = at >= 0 && at < length ? at : -1, answers = [index(made), index(made, 0), index(made, at), index(made, length), index(made, length + 5), index(made, -3), made.indexOf("Ā"), made.indexOf("Ā", 1), made.indexOf("q", 2), index(made + "é", 3)];
  if (answers[0] !== expected || answers[1] !== expected) out.push("wrong index " + length + " " + at);
  if (length % 9 === 0) out.push(answers.join());
}
for (const line of out) console.log(line);
