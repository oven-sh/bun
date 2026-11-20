// A builder on the stack that holds strings: few and many, read in between, with constants, numbers and code units behind them.
const wide = "€☃ wide 😀", narrow = "café";
function gather(pieces, limit) {
  let value = "";
  for (const piece of pieces) {
    value += piece;
    if (value.length > limit) break;
  }
  return value;
}
function seen(pieces) {
  let value = "";
  const all = [];
  for (const piece of pieces) {
    value += piece;
    all.push(value);
    if (value === wide) all.push("first");
  }
  return all.length + ":" + all.map(text => text.length).join();
}
function mixed(pieces, n) {
  let value = "";
  for (let i = 0; i < pieces.length; i++) {
    value += pieces[i];
    if (n & 1) value += ", ";
    if (n & 2) value += i;
    if (n & 4) value += i + 0.5;
    if (n & 8) value += n > 8;
    if (n & 16) value += String.fromCharCode(0x20ac + i);
    if (n & 32) value += null;
    if (n & 64) value += pieces[i].slice(1, 4);
  }
  return value;
}
function thrown(pieces, at) {
  let value = "";
  try {
    for (let i = 0; i < pieces.length; i++) {
      value += pieces[i];
      if (i === at) throw new Error(value);
    }
  } catch (error) {
    return error.message.length + "/" + value.length;
  }
  return value.length;
}
function sum(text) {
  let h = text.length;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return h;
}
let out = "";
for (let k = 0; k < 400; k++) {
  const pieces = [];
  for (let i = 0, n = k % 23; i < n; i++) {
    const at = (k * 7 + i * 5) % 6;
    pieces.push(at === 0 ? wide : at === 1 ? narrow : at === 2 ? wide.slice(0, 1 + (k % 6)) : at === 3 ? narrow.repeat(60) : at === 4 ? wide.repeat(1 + (k % 130)) : "");
  }
  const joined = pieces.join("");
  if (gather(pieces, 1e9) !== joined) console.log("WRONG", k);
  const expected = pieces.map((piece, i) => piece + (k & 1 ? ", " : "") + (k & 2 ? i : "") + (k & 4 ? i + 0.5 : "") + (k & 8 ? (k & 127) > 8 : "") + (k & 16 ? String.fromCharCode(0x20ac + i) : "") + (k & 32 ? null : "") + (k & 64 ? piece.slice(1, 4) : "")).join("");
  if (mixed(pieces, k & 127) !== expected) console.log("WRONG MIX", k);
  out += [sum(gather(pieces, 100)), sum(gather(pieces, 5000)), seen(pieces), thrown(pieces, k % 5)].join(" ") + "\n";
}
console.log(sum(out), out.length, out.slice(0, 200));
