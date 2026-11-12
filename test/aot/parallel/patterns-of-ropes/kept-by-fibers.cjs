// Patterns that are ropes: of the same strings again, of strings made anew in their places after collections, with other flags, of parts of strings.
const texts = ["\r\nDate: now\r\nConnection: close\r\nTransfer-Encoding: chunked\r\n\r\n", "\r\nConnection: keep-alive\r\n\r\n", "x0y x1y x2y x3y x4y", "AB ab Ab"];
const out = [];
let hash = 0;
function take(value) {
  const text = String(value);
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
}
function headerOf(text, name, flags) {
  const match = text.match(new RegExp("\\r\\n" + name + ": ([^\\r]*)\\r\\n", flags));
  return match ? (flags.includes("g") ? match.length + match[0] : match[1]) : "none";
}
function numbered(fiber) {
  return new RegExp("x" + fiber + "y");
}
const known = [/x0y/, /x1y/, /x2y/, /x3y/, /x4y/, /\r\nDate: ([^\r]*)\r\n/, /\r\nConnection: ([^\r]*)\r\n/g, /ab/, /ab/i, /ab/g];
const names = ["Date", "Connection", "Transfer-Encoding"];
const digits = ["0", "1", "2", "3", "4"];
let kept = [];
for (let turn = 0; turn < 4000; turn++) {
  for (const name of names) take(headerOf(texts[turn & 1], name, turn % 7 === 0 ? "gi" : ""));
  const made = [];
  for (let k = 0; k < 5; k++) {
    const fresh = digits[(turn + k) % 5] + "";
    const other = ("z" + digits[(turn * 3 + k) % 5] + "z").substring(1, 2);
    const long = (digits[(turn + k) % 5] + "y x" + digits[(turn + 2 * k) % 5]);
    made.push(numbered(fresh), numbered(other), numbered(long));
  }
  for (const pattern of made) take(pattern.source + pattern.test(texts[2]) + pattern.lastIndex);
  const letters = turn % 3 ? "a" : "A";
  for (const flags of ["", "i", "g", "gi", "y"]) {
    const pattern = new RegExp(letters + "b" + "", flags);
    const rope = new RegExp((letters + "") + ("b" + ""), flags);
    take(pattern.flags + rope.flags + texts[3].replace(pattern, "-") + texts[3].replace(rope, "+"));
  }
  kept.push(made, "pad" + turn, [turn]);
  if (kept.length > 600) kept = [];
  if (turn % 500 === 499) {
    if (typeof Bun !== "undefined") Bun.gc(turn % 1000 === 999);
    out.push(turn, hash);
  }
}
out.push(known.map(pattern => pattern.source + pattern.flags).join(" "));
console.log(out.join("\n"));
