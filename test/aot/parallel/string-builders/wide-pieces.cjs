// Pieces of wide and of Latin-1 text in turns, short and long, joined in a loop.
function joined(pieces) {
  let value = "";
  for (let i = 0; i < pieces.length; i++) value += pieces[i][1];
  return value;
}
function framed(pieces, mark) {
  let value = mark;
  for (const piece of pieces) {
    value += piece;
    if (value.length > 300) break;
    value += ";";
  }
  return value + mark;
}
function counted(source) {
  let out = "";
  let at = 0;
  for (let i = 0; i <= source.length; i++) {
    if (i < source.length && source[i] !== "|") continue;
    out += source.slice(at, i);
    out += i;
    at = i + 1;
  }
  return out;
}
const wide = "€☃ wide text 😀", narrow = "café plain";
const part = (text, from, to) => (text + text + text).slice(from, to);
const sums = [];
function sum(text) {
  let h = text.length;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return h + ":" + text.length;
}
for (let k = 0; k < 300; k++) {
  const pieces = [];
  for (let i = 0; i <= k % 7; i++) {
    const kind = (k * 5 + i * 3) % 8;
    pieces.push(["word", kind === 0 ? part(wide, 1, 2 + (k % 20)) : kind === 1 ? " " : kind === 2 ? part(narrow, 0, k % 30) : kind === 3 ? "" : kind === 4 ? wide.repeat(1 + (k % 9)) : kind === 5 ? narrow.repeat(1 + (k % 40)) : kind === 6 ? part(wide, 0, 3) + part(narrow, 0, 9) : "€"]);
  }
  const value = joined(pieces);
  sums.push(sum(value));
  if (value !== pieces.map(piece => piece[1]).join("")) console.log("WRONG", k, value);
  if (pieces.length === 1 && k < 20) console.log(JSON.stringify(value), value === pieces[0][1], { [value]: 1 }[pieces[0][1]]);
  sums.push(sum(framed(pieces.map(piece => piece[1]), k % 3 ? "'" : "‹")));
  sums.push(sum(counted(pieces.map(piece => piece[1]).join("|"))));
}
console.log(sums.join(" "));
console.log(joined([["", wide.repeat(4000)]]).length, joined([["", narrow.repeat(4000)], ["", wide], ["", "x"]]).length, joined([["", undefined], ["", wide], ["", null], ["", 1.5], ["", true]]));
