// A function called with a few written strings scans them in a loop. What it works out from their lengths is returned, passed on, stored and captured.
const out = [];
function ends(text) {
  let end;
  for (let i = 0; i < text.length; i++) { if (text.charCodeAt(i) === 32) { end = i } }
  return end === undefined ? -1 : end * 10
}
out.push(ends("a b c"), ends("abc"));

function scaled(text) {
  let last = 0;
  for (let i = 0; i < text.length; i++) { if (text.charCodeAt(i) > 98) last = i; }
  return last * 1000000000;
}
out.push(scaled("abcabc"), scaled("cc"), scaled(""));

function takes(n) { return n * 3 + 1; }
function passesOn(text) {
  let spaces = 0;
  for (let i = 0; i < text.length; i++) { if (text[i] === " ") spaces += i * 100000000; }
  return takes(spaces);
}
out.push(passesOn("a b c d e f g h i j k l m n"), passesOn("no"));

const kept = { width: 0 };
function stores(text) {
  for (let i = 0; i < text.length; i++) { if (text.charCodeAt(i) === 45) kept.width = i * text.length * 100000; }
  return kept.width;
}
out.push(stores("ab-cd-"), stores("--"), kept.width);

function captures(text) {
  let at = 0;
  const read = () => at * 500000000;
  for (let i = 0; i < text.length; i++) { if (text.charCodeAt(i) === 33) at = i; }
  return read();
}
out.push(captures("hey!you!"), captures("!"));

function twice(text) {
  const before = text.length;
  let sum = 0;
  if (text === "ab" || text === "abcd") {
    for (let i = 0; i < text.length; i++) sum += text.charCodeAt(i);
    return text.length * 700000000 + sum - before;
  }
  return before * 700000000;
}
out.push(twice("ab"), twice("abcd"), twice(["ab", "cd"].join("")), twice(["abc", "defgh"].join("")));

function rope(left, right) {
  const text = left + right;
  if (text !== "one two" && text !== "three") return -2;
  let end;
  for (let i = 0; i < text.length; i++) { if (text.charCodeAt(i) === 32) end = i; }
  return end === undefined ? text.length * 600000000 : end * 600000000;
}
out.push(rope("one ", "two"), rope("thr", "ee"), rope("x", "y"));

function backwards(text) {
  let first;
  for (let i = text.length - 1; i >= 0; i--) { if (text.charCodeAt(i) === 46) first = i; }
  return first === undefined ? text.length : (first + 1) * 2147483647;
}
out.push(backwards("a.b.c"), backwards("abc"), backwards("."));

function list(text) {
  const places = [];
  for (let i = 0; i < text.length; i++) { if (text.charCodeAt(i) === 44) places.push(i * 400000000); }
  return places;
}
out.push(list("a,b,,c,d,e,f").join("|"), list("none").length);

function small(n) { return n + 1; }
function passesSmall(text) {
  let at = 0;
  for (let i = 0; i < text.length; i++) { if (text.charCodeAt(i) === 32) at = i; }
  return small(at * 10);
}
out.push(passesSmall("a b c d"), passesSmall("no"));

const record = { place: 0 };
function storesSmall(text) {
  let at = 0;
  for (let i = 0; i < text.length; i++) { if (text.charCodeAt(i) === 45) at = i; }
  record.place = at * 10;
  return record;
}
out.push(storesSmall("ab-cd-").place, storesSmall("--").place);

function capturesSmall(text) {
  let at = 0;
  for (let i = 0; i < text.length; i++) { if (text.charCodeAt(i) === 33) at = i; }
  const scaled = at * 10;
  return () => scaled + 1;
}
out.push(capturesSmall("hey!you!")(), capturesSmall("!")());

function listSmall(text) {
  const places = [];
  for (let i = 0; i < text.length; i++) { if (text.charCodeAt(i) === 44) places.push(i * 10); }
  return places;
}
out.push(listSmall("a,b,,c").join("|"), listSmall("none").length);

let seen = 0;
function variableSmall(text) {
  for (let i = 0; i < text.length; i++) { if (text.charCodeAt(i) === 46) seen = i * 10; }
}
variableSmall("a.b."); out.push(seen); variableSmall("..."); out.push(seen);

function twiceSmall(text) {
  const before = text.length;
  if (text === "ab" || text === "abcd") return text.length * 10 + (before === text.length ? 1 : 0);
  return before;
}
out.push(twiceSmall("ab"), twiceSmall("abcd"), twiceSmall(["ab", "cd"].join("")), twiceSmall(["abc", "defgh"].join("")));

function characters(text) {
  let found = 0;
  for (let i = 0; i < text.length; i++) { if (text[i] === "x" || text.at(i) === "y" || text.codePointAt(i) === 122) found = i; }
  return found * 10 + text.length * 10;
}
out.push(characters("axbycz"), characters("q"), characters(""));
console.log(out.join("\n"));
