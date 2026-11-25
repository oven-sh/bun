const rounds = Number(process.argv[2] ?? 3);
const weights = JSON.parse("[0.5, 53.5, 106.5, 159.5, 212.5, 15.5]");
const text = JSON.parse('"abcdef"');
const none = JSON.parse('""');
const longer = JSON.parse('"abcdefghij"');
const wide = JSON.parse('"\\u00e9\\u4e2d\\ud83d\\ude00"');
const joined = [text, wide].join("-").slice(1);
const grown = text + rounds + wide;
const boxed = new String(text);
const heir = new (class extends String { get length() { return 2; } })("abcdef");
function overText(start) { let total = start & 3; for (let i = 0; i < text.length; i++) total += weights[i]; return total; }
function overNone(start) { let total = start & 3; for (let i = 0; i < none.length; i++) total += weights[i]; return total; }
function overLonger(start) { let total = start & 3; for (let i = 0; i < longer.length; i++) total += weights[i]; return total; }
function overWide(start) { let total = start & 3; for (let i = 0; i < wide.length; i++) total += weights[i]; return total; }
function overJoined(start) { let total = start & 3; for (let i = 0; i < joined.length; i++) total += weights[i]; return total; }
function overGrown(start) { let total = start & 3; for (let i = 0; i < grown.length; i++) total += weights[i]; return total; }
function overBoxed(start) { let total = start & 3; for (let i = 0; i < boxed.length; i++) total += weights[i]; return total; }
function overHeir(start) { let total = start & 3; for (let i = 0; i < heir.length; i++) total += weights[i]; return total; }
const byName = { overText, overNone, overLonger, overWide, overJoined, overGrown, overBoxed, overHeir };
const said = [];
for (const name of JSON.parse('["overText", "overNone", "overLonger", "overWide", "overJoined", "overGrown", "overBoxed", "overHeir"]')) {
  for (let round = 0; round < rounds; round++) said.push(String(byName[name](round)));
}
console.log(said.join(" "));
