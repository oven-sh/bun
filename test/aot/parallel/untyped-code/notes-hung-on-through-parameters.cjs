// One class alone lists `hint`; the other objects are given it late, through parameters that callers hand them. What lies in a list is read by that name.
"use strict";
function Reader(text) {
  this.text = text;
  this.at = 0;
  this.hint = null;
  this.open = [];
}
function Piece(kind, from) {
  this.kind = kind;
  this.from = from;
  this.to = -1;
}
function hang(target, hint) {
  if (target.hint) target.hint.push(hint);
  else target.hint = [hint];
}
function close(target, to) {
  target.to = to;
  return target;
}
Reader.prototype.last = function () {
  return this.open[this.open.length - 1];
};
Reader.prototype.step = function () {
  const letter = this.text[this.at++];
  if (letter === "(") this.open.push(new Piece("group", this.at));
  else if (letter === ")") {
    const piece = close(this.open.pop(), this.at);
    const around = this.last();
    if (around) around.size = (around.size || 0) + (piece.hint ? piece.hint.length : 1);
    else this.hint = piece;
    return piece;
  } else if (letter === "'") {
    const around = this.last();
    if (around) hang(around, this.at);
    else hang(this, this.at);
  }
  return null;
};
function read(text) {
  const reader = new Reader(text);
  const closed = [];
  while (reader.at < text.length) {
    const piece = reader.step();
    if (piece) closed.push(piece);
  }
  return { reader, closed };
}
function told(pieces) {
  let out = "";
  for (const piece of pieces) out += piece.kind + piece.from + "-" + piece.to + "[" + (piece.hint ? piece.hint.join("+") : piece.hint) + "]" + (piece.size === undefined ? "" : piece.size) + " ";
  return out;
}
for (let round = 0; round < 25; round++) {
  const { reader, closed } = read("(a'('b)" + "(c)".repeat(round % 4) + "''d)");
  if (round % 6 === 0) console.log(told(closed), reader.open.length, reader.hint && reader.hint.kind);
}
try {
  const loose = read("''x(y)'");
  console.log(told(loose.closed), loose.reader.hint);
} catch (error) {
  console.log(error.constructor.name);
}
const open = read("''x(y'z");
console.log(told(open.closed), open.reader.hint.join(), told(open.reader.open));
const list = [new Reader(""), new Piece("bare", 1), { hint: "text" }, Object.create(new Reader("p")), null, "text"];
for (const one of list) {
  try {
    console.log(String(one.hint), "hint" in Object(one), Object.prototype.hasOwnProperty.call(one, "hint"));
  } catch (error) {
    console.log(error.constructor.name);
  }
}
hang(Piece.prototype, "shared");
const after = new Piece("after", 2);
console.log(String(after.hint), Object.keys(after).join(), told([after]));
hang(after, "more");
console.log(Piece.prototype.hint.join(), Object.keys(after).join());
