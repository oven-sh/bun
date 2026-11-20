const rounds = Number(process.argv[2] ?? 3);
const weights = JSON.parse("[0.5, 53.5, 106.5, 159.5, 212.5, 15.5]");
let asked = 0;
const order = [];
const text = JSON.parse('"abcdef"');
const record = JSON.parse('{"length":6}');
const fraction = JSON.parse('{"length":4.5}');
const view = new Float64Array(6);
const counting = { get length() { asked++; order.push(asked); return 3; } };
const shrinking = { left: 5, get length() { return this.left--; } };
const empty = JSON.parse("[]");
const nothing = JSON.parse("null");
function overText(start) { let total = start & 3; for (let i = 0; i < text.length; i++) total += weights[i]; return total; }
function overRecord(start) { let total = start & 3; for (let i = 0; i < record.length; i++) total += weights[i]; return total; }
function overFraction(start) { let total = start & 3; for (let i = 0; i < fraction.length; i++) total += weights[i]; return total; }
function overView(start) { let total = start & 3; for (let i = 0; i < view.length; i++) total += weights[i]; return total; }
function overCounting(start) { let total = start & 3; for (let i = 0; i < counting.length; i++) total += weights[i]; return total; }
function overShrinking(start) { shrinking.left = 5; let total = start & 3; for (let i = 0; i < shrinking.length; i++) total += weights[i]; return total; }
function overEmpty(start) { let total = start & 3; for (let i = 0; i < empty.length; i++) total += weights[i]; return total; }
function overNothing(start) { let total = start & 3; for (let i = 0; i < nothing.length; i++) total += weights[i]; return total; }
const byName = { overText, overRecord, overFraction, overView, overCounting, overShrinking, overEmpty, overNothing };
const said = [];
for (const name of JSON.parse('["overText", "overRecord", "overFraction", "overView", "overCounting", "overShrinking", "overEmpty", "overNothing"]')) {
  for (let round = 0; round < rounds; round++) {
    try { said.push(String(byName[name](round))); } catch (error) { said.push(error.name); }
  }
}
console.log(said.join(" ") + " asked " + asked + " last " + order[order.length - 1]);
