// JSON.stringify of texts with quotes, backslashes and control characters at every place of a vector, of every length around the vector's size.
let hash = 0; const mix = text => { for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0; };
function inList(text) { return JSON.stringify([1, text]); }
function alone(text) { return JSON.stringify(text); }
function inRecord(text) { return JSON.stringify({ a: text, b: 1, [text.slice(0, 3)]: text }); }
const flat = text => Buffer.from(text, "latin1").toString("latin1");
const special = ['"', "\\", "\n", "\t", "\r", "\b", "\f", "\0", "\x01", "\x1f", " ", "\x7f", "\x80", "\xff", "/", "'", "a"];
const lines = [];
for (const character of special) {
  let before = hash;
  for (let length = 0; length <= 70; length++) for (let at = 0; at < length; at += length > 40 ? 3 : 1) { const text = flat("x".repeat(at) + character + "y".repeat(length - at - 1)); mix(inList(text)); mix(alone(text)); }
  lines.push(JSON.stringify(character) + " " + (hash - before | 0));
}
for (let every = 1; every <= 20; every++) for (const character of ['"', "\\", "\n", '"\\']) { let text = ""; for (let i = 0; i < 400; i++) text += i % every ? "abcdefghij"[i % 10] : character; text = flat(text); mix(inList(text)); mix(inRecord(text)); if (every < 4) lines.push(every + JSON.stringify(character) + inList(text.slice(0, 40))); }
let seed = 12345; const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) >>> 8;
for (let round = 0; round < 3000; round++) { let text = ""; const length = next() % 90, kind = next() % 4; for (let i = 0; i < length; i++) { const r = next(); text += kind === 0 ? String.fromCharCode(r % 256) : kind === 1 ? '"\\ab'[r % 4] : kind === 2 ? (r % 9 ? "k" : special[r % special.length]) : String.fromCharCode(32 + r % 95); } text = flat(text); const quoted = inList(text); mix(quoted); if (JSON.parse(quoted)[1] !== text) lines.push("does not come back: " + alone(text)); }
lines.push("random " + hash);
const row = JSON.stringify(["$", "td", null, { className: "a \"b\" \\c", children: ["x\ny", 1, { title: "t" }] }]);
lines.push(inList(row), inList(inList(row)), inList(inList(inList(row))).length, inList(row.repeat(50)).length, alone("日" + row).length, inList("日\"\\\n" + row), inList((row + "日").slice(0, -1)).length, inList("a".repeat(5000) + '"').length, inList('"' + "a".repeat(5000)).length, inList("a".repeat(63) + '"' + "b".repeat(64)).length);
lines.push(JSON.stringify({ '"': 1, "\\": 2, "a\"b\"c\"d\"e\"f\"g\"h\"i\"j": 3 }), JSON.stringify(['"', "\\", '""""""""""""""""', "\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\"]), JSON.stringify([row], null, 2).length, JSON.stringify({ toJSON() { return row; } }));
// Plain Bun quotes by the same routine as the compiled program, so that the two agree says little. These lines were printed by the routine that wrote one escaped character at a time.
const expected = [
  "\"\\\"\" -310951917",
  "\"\\\\\" -2080290793",
  "\"\\n\" -207565941",
  "\"\\t\" -1273040505",
  "\"\\r\" -1774792141",
  "\"\\b\" 90353747",
  "\"\\f\" 1824519483",
  "\"\\u0000\" -12381935",
  "\"\\u0001\" -1814389669",
  "\"\\u001f\" -2083048093",
  "\" \" -1932941531",
  "\"\u007f\" 1260445825",
  "\"\u0080\" -1321136219",
  "\"\u00ff\" 444325249",
  "\"/\" 1353284801",
  "\"'\" 549915681",
  "\"a\" 1546734025",
  "1\"\\\"\"[1,\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\"]",
  "1\"\\\\\"[1,\"\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\"]",
  "1\"\\n\"[1,\"\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\\n\"]",
  "1\"\\\"\\\\\"[1,\"\\\"\\\\\\\"\\\\\\\"\\\\\\\"\\\\\\\"\\\\\\\"\\\\\\\"\\\\\\\"\\\\\\\"\\\\\\\"\\\\\\\"\\\\\\\"\\\\\\\"\\\\\\\"\\\\\\\"\\\\\\\"\\\\\\\"\\\\\\\"\\\\\\\"\\\\\\\"\\\\\"]",
  "2\"\\\"\"[1,\"\\\"b\\\"d\\\"f\\\"h\\\"j\\\"b\\\"d\\\"f\\\"h\\\"j\\\"b\\\"d\\\"f\\\"h\\\"j\\\"b\\\"d\\\"f\\\"h\\\"j\"]",
  "2\"\\\\\"[1,\"\\\\b\\\\d\\\\f\\\\h\\\\j\\\\b\\\\d\\\\f\\\\h\\\\j\\\\b\\\\d\\\\f\\\\h\\\\j\\\\b\\\\d\\\\f\\\\h\\\\j\"]",
  "2\"\\n\"[1,\"\\nb\\nd\\nf\\nh\\nj\\nb\\nd\\nf\\nh\\nj\\nb\\nd\\nf\\nh\\nj\\nb\\nd\\nf\\nh\\nj\"]",
  "2\"\\\"\\\\\"[1,\"\\\"\\\\b\\\"\\\\d\\\"\\\\f\\\"\\\\h\\\"\\\\j\\\"\\\\b\\\"\\\\d\\\"\\\\f\\\"\\\\h\\\"\\\\j\\\"\\\\b\\\"\\\\d\\\"\\\\f\\\"\"]",
  "3\"\\\"\"[1,\"\\\"bc\\\"ef\\\"hi\\\"ab\\\"de\\\"gh\\\"ja\\\"cd\\\"fg\\\"ij\\\"bc\\\"ef\\\"hi\\\"\"]",
  "3\"\\\\\"[1,\"\\\\bc\\\\ef\\\\hi\\\\ab\\\\de\\\\gh\\\\ja\\\\cd\\\\fg\\\\ij\\\\bc\\\\ef\\\\hi\\\\\"]",
  "3\"\\n\"[1,\"\\nbc\\nef\\nhi\\nab\\nde\\ngh\\nja\\ncd\\nfg\\nij\\nbc\\nef\\nhi\\n\"]",
  "3\"\\\"\\\\\"[1,\"\\\"\\\\bc\\\"\\\\ef\\\"\\\\hi\\\"\\\\ab\\\"\\\\de\\\"\\\\gh\\\"\\\\ja\\\"\\\\cd\\\"\\\\fg\\\"\\\\ij\"]",
  "random -1476102496",
  "[1,\"[\\\"$\\\",\\\"td\\\",null,{\\\"className\\\":\\\"a \\\\\\\"b\\\\\\\" \\\\\\\\c\\\",\\\"children\\\":[\\\"x\\\\ny\\\",1,{\\\"title\\\":\\\"t\\\"}]}]\"]",
  "[1,\"[1,\\\"[\\\\\\\"$\\\\\\\",\\\\\\\"td\\\\\\\",null,{\\\\\\\"className\\\\\\\":\\\\\\\"a \\\\\\\\\\\\\\\"b\\\\\\\\\\\\\\\" \\\\\\\\\\\\\\\\c\\\\\\\",\\\\\\\"children\\\\\\\":[\\\\\\\"x\\\\\\\\ny\\\\\\\",1,{\\\\\\\"title\\\\\\\":\\\\\\\"t\\\\\\\"}]}]\\\"]\"]",
  "266",
  "5106",
  "105",
  "[1,\"\u65e5\\\"\\\\\\n[\\\"$\\\",\\\"td\\\",null,{\\\"className\\\":\\\"a \\\\\\\"b\\\\\\\" \\\\\\\\c\\\",\\\"children\\\":[\\\"x\\\\ny\\\",1,{\\\"title\\\":\\\"t\\\"}]}]\"]",
  "108",
  "5008",
  "5008",
  "135",
  "{\"\\\"\":1,\"\\\\\":2,\"a\\\"b\\\"c\\\"d\\\"e\\\"f\\\"g\\\"h\\\"i\\\"j\":3}",
  "[\"\\\"\",\"\\\\\",\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\\\"\",\"\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\\"]",
  "110",
  "\"[\\\"$\\\",\\\"td\\\",null,{\\\"className\\\":\\\"a \\\\\\\"b\\\\\\\" \\\\\\\\c\\\",\\\"children\\\":[\\\"x\\\\ny\\\",1,{\\\"title\\\":\\\"t\\\"}]}]\"",
];
console.log(lines.join("\n"));
console.log(lines.length === expected.length && lines.every((line, i) => String(line) === expected[i]) ? "as the routine before it printed" : "DIFFERS from what the routine before it printed at line " + lines.findIndex((line, i) => String(line) !== expected[i]));
