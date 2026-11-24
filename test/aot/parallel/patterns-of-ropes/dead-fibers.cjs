// new RegExp() of a rope whose fibers are strings made anew where strings of other texts lay before a collection.
const known = [/\r\nHeader-0: ([^\r]*)\r\n/, /\r\nHeader-1: ([^\r]*)\r\n/, /\r\nHeader-2: ([^\r]*)\r\n/, /\r\nHeader-3: ([^\r]*)\r\n/];
const text = "\r\nHeader-0: zero\r\nHeader-1: one\r\n\r\nHeader-2: two\r\n\r\nHeader-3: three\r\n";
const bytes = Buffer.from("Header-0", "latin1");
let wrong = 0;
let hash = 0;
function name(digit) {
  bytes[7] = 48 + digit;
  return bytes.toString("latin1");
}
function pattern(fiber) {
  return new RegExp("\\r\\n" + fiber + ": ([^\\r]*)\\r\\n");
}
function lay(digit, count) {
  let fiber;
  for (let i = 0; i < count; i++) {
    fiber = name(digit);
    const found = pattern(fiber);
    const match = text.match(found);
    if (found.source !== known[digit].source || match === null || match[1] !== ["zero", "one", "two", "three"][digit]) wrong++;
    hash = (hash * 31 + found.source.charCodeAt(11) + (match === null ? 0 : match.index)) | 0;
  }
  return count;
}
let laid = 0;
for (let turn = 0; turn < 300; turn++) {
  laid += lay(turn % 4, 12);
  if (typeof Bun !== "undefined") Bun.gc(true);
}
console.log(laid, wrong, hash, known.map(p => p.source).join());
