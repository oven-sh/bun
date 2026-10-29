// JSON.stringify where the output has 16 bits a character: quotes, backslashes, control characters and surrogates at every place of a vector, in texts of 8 and of 16 bits a character.
let hash = 0; const mix = text => { for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0; };
function alone(text) { return JSON.stringify(text); }
function inList(text) { return JSON.stringify(["\u65e5", text]); }
function inRecord(text) { return JSON.stringify({ wide: "\u2728", text, [text.slice(0, 2)]: 1 }); }
const narrow = text => Buffer.from(text, "latin1").toString("latin1");
const special = ['"', "\\", "\n", "\t", "\r", "\b", "\f", "\0", "\x01", "\x0b", "\x0e", "\x10", "\x18", "\x1a", "\x1f", " ", "\x7f", "\x80", "\xff", "\u0100", "\u0122", "\u015c", "\u010a", "\u2028", "\u2029", "\ud7ff", "\ud800", "\udbff", "\udc00", "\udfff", "\ue000", "\uffff", "\ud83d\ude00", "\ude00\ud83d", "a"];
const lines = [];
for (const character of special) {
  const before = hash;
  for (let length = 0; length <= 40; length++) for (let at = 0; at + character.length <= length; at++) {
    const body = "x".repeat(at) + character + "y".repeat(length - at - character.length);
    mix(alone("\u65e5" + body)); mix(alone(body + "\u65e5")); mix(inList(body)); if (!/[^\x00-\xff]/.test(body)) mix(inList(narrow(body)));
    if (length % 7 === 0) mix(inRecord(body));
  }
  lines.push(JSON.stringify(character) + " " + (hash - before | 0));
}
for (let every = 1; every <= 12; every++) for (const character of ['"', "\\", "\n", '"\\', "\ud83d\ude00", "\ud800", "\x01"]) { let text = ""; for (let i = 0; i < 300; i++) text += i % every ? "abcdefghij"[i % 10] : character; mix(inList(text)); mix(alone(text + "\u65e5")); if (every < 3) lines.push(every + JSON.stringify(character) + inList(text.slice(0, 24))); }
let seed = 777; const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) >>> 8;
for (let round = 0; round < 4000; round++) { let text = ""; const length = next() % 70, kind = next() % 5; for (let i = 0; i < length; i++) { const r = next(); text += kind === 0 ? String.fromCharCode(r % 65536) : kind === 1 ? '"\\a\u65e5'[r % 4] : kind === 2 ? (r % 9 ? "k" : special[r % special.length]) : kind === 3 ? String.fromCharCode(0xd7f0 + r % 0x820) : String.fromCharCode(r % 256); } const quoted = inList(text); mix(quoted); if (text.isWellFormed() && JSON.parse(quoted)[1] !== text) lines.push("does not come back: " + alone(text)); mix(alone(text)); }
lines.push("random " + hash);
const code = 'function greet(name: string): string {\n  const text = "hello, " + name;\n  return text + "!";\n}\n\n';
lines.push(inRecord("\u2728" + code.repeat(3)), inRecord(code.repeat(200)).length, alone("\u2728" + code.repeat(3000)).length, inList(narrow(code.repeat(300))).length, JSON.stringify({ a: narrow(code), b: "\u65e5" + code, c: [code, "\ud800" + code] }, null, 2).length);
// Plain Bun quotes by the same routine as the compiled program, so that the two agree says little. These lines were printed by the routine that wrote one escaped character at a time.
const expected = [
  "\"\\\"\" 1756719203",
  "\"\\\\\" 1511498383",
  "\"\\n\" -2035799205",
  "\"\\t\" 1439519539",
  "\"\\r\" -176505741",
  "\"\\b\" 1894922845",
  "\"\\f\" 1753414391",
  "\"\\u0000\" -1394384004",
  "\"\\u0001\" 120836609",
  "\"\\u000b\" -1199842100",
  "\"\\u000e\" -853875541",
  "\"\\u0010\" -1968076361",
  "\"\\u0018\" -1794164015",
  "\"\\u001a\" -290125292",
  "\"\\u001f\" 1583480925",
  "\" \" -328101189",
  "\"\u007f\" 1429731500",
  "\"\u0080\" -261455141",
  "\"\u00ff\" 293838508",
  "\"\u0100\" 926469133",
  "\"\u0122\" -186697993",
  "\"\u015c\" 1222445913",
  "\"\u010a\" 1892005759",
  "\"\u2028\" -600073003",
  "\"\u2029\" 1759134330",
  "\"\ud7ff\" -606160536",
  "\"\\ud800\" 537843572",
  "\"\\udbff\" 1210748618",
  "\"\\udc00\" -32053319",
  "\"\\udfff\" -1553405200",
  "\"\ue000\" -25775859",
  "\"\uffff\" -517997208",
  "\"\ud83d\ude00\" -336158856",
  "\"\\ude00\\ud83d\" 11792289",
  "\"a\" -697749590",
  "1\"\\\"\"[\"\u65e5\",\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\"]",
  "1\"\\\\\"[\"\u65e5\",\"\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\"]",
  "1\"\\n\"[\"\u65e5\",\"\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\"]",
  "1\"\\\"\\\\\"[\"\u65e5\",\"\\\"\\\\\\\"\\\\\\\"\\\\\\\"\\\\\\\"\\\\\\\"\\\\\\\"\\\\\\\"\\\\\\\"\\\\\\\"\\\\\\\"\\\\\\\"\\\\\"]",
  "1\"\ud83d\ude00\"[\"\u65e5\",\"\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\ud83d\ude00\"]",
  "1\"\\ud800\"[\"\u65e5\",\"\\ud800\\ud800\\ud800\\ud800\\ud800\\ud800\\ud800\\ud800\\ud800\\ud800\\ud800\\ud800\\ud800\\ud800\\ud800\\ud800\\ud800\\ud800\\ud800\\ud800\\ud800\\ud800\\ud800\\ud800\"]",
  "1\"\\u0001\"[\"\u65e5\",\"\\u0001\\u0001\\u0001\\u0001\\u0001\\u0001\\u0001\\u0001\\u0001\\u0001\\u0001\\u0001\\u0001\\u0001\\u0001\\u0001\\u0001\\u0001\\u0001\\u0001\\u0001\\u0001\\u0001\\u0001\"]",
  "2\"\\\"\"[\"\u65e5\",\"\\\"b\\\"d\\\"f\\\"h\\\"j\\\"b\\\"d\\\"f\\\"h\\\"j\\\"b\\\"d\"]",
  "2\"\\\\\"[\"\u65e5\",\"\\\\b\\\\d\\\\f\\\\h\\\\j\\\\b\\\\d\\\\f\\\\h\\\\j\\\\b\\\\d\"]",
  "2\"\\n\"[\"\u65e5\",\"\\nb\\nd\\nf\\nh\\nj\\nb\\nd\\nf\\nh\\nj\\nb\\nd\"]",
  "2\"\\\"\\\\\"[\"\u65e5\",\"\\\"\\\\b\\\"\\\\d\\\"\\\\f\\\"\\\\h\\\"\\\\j\\\"\\\\b\\\"\\\\d\\\"\\\\f\"]",
  "2\"\ud83d\ude00\"[\"\u65e5\",\"\ud83d\ude00b\ud83d\ude00d\ud83d\ude00f\ud83d\ude00h\ud83d\ude00j\ud83d\ude00b\ud83d\ude00d\ud83d\ude00f\"]",
  "2\"\\ud800\"[\"\u65e5\",\"\\ud800b\\ud800d\\ud800f\\ud800h\\ud800j\\ud800b\\ud800d\\ud800f\\ud800h\\ud800j\\ud800b\\ud800d\"]",
  "2\"\\u0001\"[\"\u65e5\",\"\\u0001b\\u0001d\\u0001f\\u0001h\\u0001j\\u0001b\\u0001d\\u0001f\\u0001h\\u0001j\\u0001b\\u0001d\"]",
  "random 1611928714",
  "{\"wide\":\"\u2728\",\"text\":\"\u2728function greet(name: string): string {\\n  const text = \\\"hello, \\\" + name;\\n  return text + \\\"!\\\";\\n}\\n\\nfunction greet(name: string): string {\\n  const text = \\\"hello, \\\" + name;\\n  return text + \\\"!\\\";\\n}\\n\\nfunction greet(name: string): string {\\n  const text = \\\"hello, \\\" + name;\\n  return text + \\\"!\\\";\\n}\\n\\n\",\"\u2728f\":1}",
  "21029",
  "315003",
  "31508",
  "480",
];
console.log(lines.join("\n"));
console.log(lines.length === expected.length && lines.every((line, i) => String(line) === expected[i]) ? "as the routine before it printed" : "DIFFERS from what the routine before it printed at line " + lines.findIndex((line, i) => String(line) !== expected[i]));
