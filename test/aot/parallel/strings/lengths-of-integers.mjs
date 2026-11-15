// The length of a number's string: digits at every border, in and outside loops, of numbers that are no integers too.
const edges = [0, 1, 9, 10, 99, 100, 999, 1000, 9999, 10000, 99999, 100000, 999999, 1000000, 9999999, 10000000, 99999999, 100000000, 999999999, 1000000000, 2147483647];
function small(turns) {
  let n = 0;
  for (let k = 0; k < turns; k++) n = (n * 7 + String(k % 1000).length + (k % 100 + "").length + ("" + (k & 15)).length + `${k & 255}`.length) | 0;
  return n;
}
function wide(turns) {
  const lengths = [];
  for (let k = 0; k < turns; k++) {
    const v = (k * 2654435761) >>> 1;
    lengths.push(String(v).length, String(v >>> 9).length, String(10 + (v % 90)).length, (v | 0).toString().length);
  }
  return lengths.join("");
}
function atEdges() {
  let text = "";
  for (let k = 0; k < edges.length; k++) {
    const v = edges[k] & 0x7fffffff;
    text += String(v).length + ":" + (v + "").length + ":" + String(v - 5).length + ":" + String(-v).length + " ";
  }
  return text;
}
function kept(turns) {
  let last = "";
  let n = 0;
  for (let k = 0; k < turns; k++) {
    last = String(k % 2000);
    n += last.length;
  }
  return n + last;
}
function noIntegers(turns) {
  let n = 0;
  for (let k = 0; k < turns; k++) n += String(k / 4).length + String(-(k % 3)).length + String(k * 1e15).length + (k % 37).toString(2).length;
  return n;
}
function outsideLoops(v) {
  return String(v & 7).length + String(v & 63).length + String(v & 1023).length + (v % 10 + "").length;
}
function frames(turns) {
  let text = "";
  for (let k = 0; k < turns; k++) text += "0".repeat(4 - String(k % 10000).length) + (k % 10000) + (k % 8 ? " " : "\n");
  return text.length;
}
console.log(small(1), small(20011), wide(300));
console.log(atEdges());
console.log(kept(12345), noIntegers(4321), frames(23456));
console.log([0, 9, 10, 63, 64, 99, 100, 1023].map(outsideLoops).join());
