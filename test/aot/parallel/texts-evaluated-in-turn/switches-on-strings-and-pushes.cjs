// Evaluated text is interpreted in an executable: switches on strings that are atoms, made at run time, ropes or no strings at all, before and after collections, in text that is evaluated
// anew each time, and Array.prototype.push() of several values onto arrays of every kind.
const { edenGC, fullGC } = require("bun:jsc");
const lines = [];
globalThis.log = (...values) => void lines.push(values.map(value => (Object.is(value, -0) ? "-0" : typeof value === "bigint" ? `${value}n` : typeof value === "symbol" ? value.toString() : typeof value === "function" ? "function" : JSON.stringify(value) ?? String(value))).join(" "));
globalThis.collect = () => void fullGC();
globalThis.collectYoung = () => void edenGC();
globalThis.make = text => {
  let made = "";
  for (const character of text) made += character;
  return made;
};
const evaluate = text => {
  try {
    log((0, eval)(text));
  } catch (error) {
    log(error instanceof Error ? `${error.name}: ${error.message}` : error);
  }
};

const words = ["", "a", "div", "span", "children", "className", "style", "0", "12", "constructor", "__proto__", "toString", "ü", "日本", "x".repeat(40), "onclick"];
globalThis.words = words;
for (let round = 0; round < 6; round++) {
  const cases = words.filter((_, index) => (index + round) % 3);
  evaluate(`(function () {
    const pick = (value, fall) => { let s = ""; switch (value) { ${cases.map((word, index) => `case ${JSON.stringify(word)}: s += ${index};${index % 4 ? " break;" : ""}`).join(" ")} default: s += "d"; } return s; };
    const only = value => { switch (value) { case ${JSON.stringify(cases[round])}: return "only"; } return "none"; };
    const answers = [];
    for (let turn = 0; turn < 4; turn++) {
      for (const word of words) answers.push(pick(word), only(word), pick(make(word)), only(word.concat()), pick((word + "?").slice(0, -1)), pick(word + "x"), pick(new String(word)));
      for (const value of [undefined, null, 0, 12, 1.5, -0, true, 10n, Symbol.iterator, {}, [], ["a"], () => 1]) answers.push(pick(value), only(value));
      for (let k = 0; k < 40; k++) answers.push(pick(words[k % words.length]), only(words[(k * 7) % words.length]));
      if (turn === 1) collectYoung(); else if (turn === 2) collect();
    }
    return answers.join();
  })()`);
  if (round & 1) fullGC();
}

globalThis.Sub = class Sub extends Array {};
globalThis.old = ["old"];
globalThis.fixed = list => Object.defineProperty(list, "length", { writable: false });
fullGC();
const values = ["1", "2.5", "'p'", "{}", "undefined", "null", "NaN", "10n", "-0", "true", "Symbol.iterator", "'q'"];
for (const list of ["[]", "[1]", "[1.5]", "['a']", "['a', , 'b']", "[,]", "new Array(8)", "new Sub()", "old", "fixed(['f'])", "Object.freeze(['x'])", "Object.preventExtensions(['p'])", "'a b c'.split(' ')", "[['a'], ['b']].flat()", "JSON.parse('[1,\"2\"]')", "{ length: 1, 0: 'o' }", "'text'", "null", "(function () { return arguments; })('g')"])
  evaluate(`(function () {
    const answers = [], attempt = f => { try { answers.push(f()); } catch (error) { answers.push(error.name); } };
    const show = (list, length) => [length, list.length, ...Array.from({ length: Math.min(list.length, 30) }, (_, index) => index in list ? (Object.is(list[index], -0) ? "-0" : typeof list[index] === "object" ? "o" : String(list[index])) : "hole")].join(" ");
    ${[0, 2, 3, 5, 8, 9, 12].map(count => `attempt(() => { const list = ${list}; return show(list, list.push(${values.slice(0, count).join()})); });`).join("\n    ")}
    attempt(() => { const list = ${list}; let length; for (let k = 0; k < 9; k++) length = list.push(k, "k" + k, list); return length + " " + list.length; });
    attempt(() => { const list = ${list}; const length = Array.prototype.push.call(list, "x", "y", "z"); collectYoung(); return show(list, length); });
    attempt(() => { const list = ${list}; list.length = 0; list.push("only"); list.push("two", "three"); list.push(4, 5); return show(list); });
    return answers;
  })()`);
log(old.length);
console.log(lines.join("\n"));
