// Array.prototype.indexOf() and includes() with a string argument: flat strings, substrings, ropes, 8-bit and 16-bit strings of many lengths, in arrays of strings, mixed arrays, arrays with holes, number arrays and sparse arrays.
// CALLS+ inOwnTexts ArrayIndexOfString\.Strings
// CALLS+ inTexts ArrayIndexOfString\.Values
// CALLS+ inValues ArrayIndexOfString\.Values
const out = [];
let state = 12345;
function random(n) {
  state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
  return state % n;
}

const letters = "abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz";
const wide = "Ā" + letters;
const lengths = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 16, 17, 23, 24, 25, 31, 32, 33, 40, 64, 65];

// The same characters in every string representation.
const forms = {
  written: (start, length) => JSON.parse(JSON.stringify(letters.slice(start, start + length))),
  cut: (start, length) => letters.slice(start, start + length),
  cutTwice: (start, length) => letters.slice(start >> 1).slice(start - (start >> 1), start - (start >> 1) + length),
  joined: (start, length) => letters.slice(start, start + (length >> 1)) + letters.slice(start + (length >> 1), start + length),
  cutOutOfWide: (start, length) => wide.slice(1 + start, 1 + start + length),
  joinedOfThree: (start, length) => "" + letters.slice(start, start + 1 > start + length ? start + length : start + 1) + letters.slice(start + (length ? 1 : 0), start + length) + "",
};
const names = Object.keys(forms);

// Only strings are ever pushed into this array.
const ownTexts = [];
for (const length of lengths) ownTexts.push(letters.slice(1, 1 + length));
function inOwnTexts(text) {
  return ownTexts.indexOf(text) + (ownTexts.includes(text) ? "+" : "-");
}
function inTexts(list, text) {
  return list.indexOf(text) + (list.includes(text) ? "+" : "-");
}
function inValues(list, text) {
  return list.indexOf(text) + (list.includes(text) ? "+" : "-");
}
function ofAnyKind(list, value) {
  return list.indexOf(value) + (list.includes(value) ? "+" : "-");
}
function byLoop(list, value) {
  for (let i = 0; i < list.length; i++) if (i in list && list[i] === value) return i + "+";
  return "-1-";
}

function check(label, answer, list, value) {
  const expected = byLoop(list, value);
  if (answer !== expected) out.push(label + ": " + answer + " for " + expected);
}

let compared = 0;
for (const made of names) {
  for (const asked of names) {
    const texts = [];
    for (const length of lengths) for (let start = 0; start < 3; start++) texts.push(forms[made](start, length));
    const values = [];
    for (let i = 0; i < texts.length; i++) {
      values.push(texts[i]);
      values.push([1, 1.5, null, undefined, true, {}, Symbol.iterator, 10n, [], () => 1][i % 10]);
    }
    for (const length of lengths) {
      for (let start = 0; start < 4; start++) {
        check("own texts " + asked + " " + length + " " + start, inOwnTexts(forms[asked](start, length)), ownTexts, forms[asked](start, length));
        check("texts " + made + " " + asked + " " + length + " " + start, inTexts(texts, forms[asked](start, length)), texts, forms[asked](start, length));
        check("values " + made + " " + asked + " " + length + " " + start, inValues(values, forms[asked](start, length)), values, forms[asked](start, length));
        compared += 3;
      }
    }
  }
}
out.push("compared " + compared);

// Strings that differ in exactly one character, at every position.
for (const length of [1, 2, 3, 4, 5, 7, 8, 9, 12, 16, 17, 24, 31, 32, 33, 48]) {
  const whole = letters.slice(0, length);
  const list = [];
  for (let at = 0; at < length; at++) list.push(whole.slice(0, at) + "#" + whole.slice(at + 1));
  list.push(letters.slice(0, length));
  check("one place " + length, inTexts(list, (" " + whole).slice(1)), list, whole);
  for (let at = 0; at < length; at++) {
    const asked = (whole.slice(0, at) + "#" + whole.slice(at + 1) + " ").slice(0, length);
    check("one place " + length + " " + at, inTexts(list, asked), list, asked);
  }
}

// 16-bit strings on either side, including 16-bit strings whose characters all fit in 8 bits.
{
  const narrow = ["café", "naïve", "abc", ""];
  const sameAsWide = narrow.map(text => ("Ā" + text).slice(1));
  const trulyWide = ["cafę", "中文", "abcĀ", "😀"];
  for (const list of [narrow, sameAsWide, trulyWide, narrow.concat(trulyWide), trulyWide.concat(sameAsWide)]) {
    for (const asked of narrow.concat(sameAsWide, trulyWide, trulyWide.map(text => (" " + text).slice(1)))) check("units " + JSON.stringify(asked), inTexts(list, asked), list, asked);
  }
}

// Arrays with other indexing types.
{
  const empty = [];
  const integers = [1, 2, 3];
  const fractions = [0.5, 1.5];
  const withHoles = ["a", , "b", , "c"];
  const onlyHoles = new Array(5);
  const written = ["alpha", "beta", "gamma"];
  const frozen = Object.freeze(["alpha", "beta", "gamma"]);
  const shortened = ["alpha", "beta", "gamma", "delta"];
  shortened.length = 2;
  const lengthened = ["alpha", "beta"];
  lengthened.length = 6;
  const farApart = [];
  farApart[5] = "alpha";
  farApart[100000] = "beta";
  farApart[3000000] = "gamma";
  const shifted = ["x", "alpha", "beta", "gamma"];
  shifted.shift();
  const becameValues = [1, 2, 3];
  becameValues.push("alpha");
  const withNames = ["alpha", "beta"];
  withNames.extra = "gamma";
  const lists = { empty, integers, fractions, withHoles, onlyHoles, written, frozen, shortened, lengthened, shifted, becameValues, withNames };
  for (const name in lists) {
    for (const asked of ["alpha", "beta", "gamma", "delta", "a", "b", "c", "", "undefined", "1", "0.5"]) {
      const cut = (" " + asked).slice(1);
      check(name + " " + asked, inValues(lists[name], cut), lists[name], asked);
      check(name + " " + asked + " of any kind", ofAnyKind(lists[name], cut), lists[name], asked);
    }
  }
  out.push("far apart " + [farApart.indexOf((" alpha").slice(1)), farApart.indexOf((" beta").slice(1)), farApart.indexOf((" gamma").slice(1)), farApart.includes((" gamma").slice(1))].join(" "));
  for (const value of [undefined, null, 1, 0.5, NaN, true, 10n, "alpha"]) out.push("of any kind " + String(value) + " " + ofAnyKind(withHoles, value) + " " + ofAnyKind(becameValues, value) + " " + ofAnyKind(fractions, value));
}

// An array that grows between searches, with the result used as a number.
{
  const seen = [];
  let sum = 0;
  for (let i = 0; i < 3000; i++) {
    const name = "name" + random(400) + "x".repeat(random(4));
    const at = seen.indexOf(name);
    if (at < 0) seen.push(name);
    else sum += at;
  }
  out.push("grown " + seen.length + " " + sum);
}

console.log(out.join("\n"));
