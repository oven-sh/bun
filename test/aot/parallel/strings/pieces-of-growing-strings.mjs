// A string that grows by += lives in a buffer with room. Compiled code writes flat pieces of up to 256 characters into it; the runtime writes short ropes.
// Older strings end in the middle of the buffer, 16-bit pieces and long pieces make new strings.
const source = "The quick brown fox jumps over the lazy dog, and then it sleeps. ".repeat(20);
const flat = length => source.slice(0, length).split("").join("");
const hash = text => {
  let sum = 7;
  for (let i = 0; i < text.length; i++) sum = (Math.imul(sum, 31) + text.charCodeAt(i)) | 0;
  return sum;
};
const start = "0123456789abcdef".repeat(80);

function grow(pieces, count) {
  let text = "";
  for (let i = 0; i < start.length; i++) text += start[i];
  for (let i = 0; i < count; i++) text += pieces[i % pieces.length];
  return text;
}
function growByTwo(pieces, count) {
  let text = "";
  for (let i = 0; i < start.length; i++) text += start[i];
  for (let i = 0; i < count; i++) text = text + pieces[i % pieces.length] + pieces[(i + 1) % pieces.length];
  return text;
}
function expected(pieces, count, two) {
  const list = [start];
  for (let i = 0; i < count; i++) {
    list.push(pieces[i % pieces.length]);
    if (two) list.push(pieces[(i + 1) % pieces.length]);
  }
  return list.join("");
}

// Each length by itself: 0 to 20, and around 255.
for (let length = 0; length <= 20; length++) {
  const pieces = [flat(length)];
  if (grow(pieces, 900) !== expected(pieces, 900, false)) console.log("wrong", length);
  if (growByTwo(pieces, 900) !== expected(pieces, 900, true)) console.log("wrong in twos", length);
}
for (const length of [31, 32, 33, 63, 64, 65, 255, 256, 257, 1000]) {
  const pieces = [flat(length), "x", flat(length + 1)];
  if (grow(pieces, 700) !== expected(pieces, 700, false)) console.log("wrong", length);
  if (growByTwo(pieces, 700) !== expected(pieces, 700, true)) console.log("wrong in twos", length);
}

// Ropes that stay in use, substrings, 16-bit pieces.
const lasting = ["div", "span", "section"].map(tag => "<" + tag + ">");
for (const pieces of [lasting, [source.slice(3, 9), ...lasting], ["a", "é", "b"], ["a", "b", "中", "c"], ["", "q", ""]]) {
  for (let round = 0; round < 3; round++) {
    const text = grow(pieces, 1500);
    console.log(text.length, hash(text), text === expected(pieces, 1500, false), growByTwo(pieces, 800) === expected(pieces, 800, true));
  }
}

// Older strings keep their characters when a longer one is written behind them.
function branches() {
  let text = "";
  const older = [];
  for (let i = 0; i < 4000; i++) {
    text += i % 7 ? "ab" : "-";
    if (i % 500 === 499) {
      older.push(text, text + "left", text + "right" + i);
      text += "!";
    }
  }
  return older.concat(text);
}
for (const text of branches()) console.log(text.length, hash(text), text.slice(-8));

// Each step writes a piece of ropes that were made in that step.
function rows() {
  let text = "";
  for (let i = 0; i < 2000; i++) text += `<li id="${i}">` + (i & 1 ? "odd" : "even") + "</li>";
  return text;
}
const list = rows();
console.log(list.length, hash(list), list.slice(0, 40), list.slice(-40));

// What stands behind a short piece in memory is not part of the string.
function shortPieces() {
  let text = "";
  for (let i = 0; i < 1400; i++) text += ".";
  for (let i = 0; i < 600; i++) {
    const before = text.length;
    text += "#";
    if (text.length !== before + 1) return "wrong length";
    if (i % 50 === 0 && (text.charCodeAt(before) !== 35 || text.charCodeAt(before + 1) === text.charCodeAt(before + 1))) return "wrong character at " + before;
  }
  return text.slice(-5) + hash(text);
}
console.log(shortPieces());
