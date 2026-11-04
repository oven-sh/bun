// `"0"`, `"-0"`, `"01"`, `"4294967295"`, `"length"` and `"__proto__"` as written keys: an index is an element, the prototype link is no property, and the others are names.
// Under: --aot-testing=CheckProofsAtRunTime: the field that an access under a written key goes to
function at0(o) { let k ="0"; return o[k]; }
function atMinus0(o) { let k ="-0"; return o[k]; }
function at01(o) { let k ="01"; return o[k]; }
function atLargest(o) { let k ="4294967295"; return o[k]; }
function lengthOf(o) { let k ="length"; return o[k]; }
function above(o) { let k ="__proto__"; return o[k]; }
function setAbove(o, value) { let k ="__proto__"; o[k] = value; }
function set0(o, value) { let k ="0"; o[k] = value; }
function setLength(o, value) { let k ="length"; o[k] = value; }
const lines = [];
const list = ["zero", "one"];
const record = { 0: "nought", "-0": "minus", "01": "padded", 4294967295: "largest", length: "own" };
const bytes = new Uint8Array([7, 8]);
for (const o of [list, record, bytes, "text"]) lines.push([at0(o), atMinus0(o), at01(o), atLargest(o), lengthOf(o)].join());
set0(list, "stored"); set0(record, "stored"); set0(bytes, 300);
setLength(list, 1); setLength(record, 1);
lines.push(list.join(), JSON.stringify(record), bytes.join());
lines.push(above(list) === Array.prototype, above(record) === Object.prototype, above(Object.create(null)));
const child = { own: 1 };
setAbove(child, { inherited: 2 });
lines.push(child.inherited, Object.keys(child).join(), above(child).inherited);
setAbove(child, 5);
lines.push(child.inherited);
const bare = Object.create(null);
setAbove(bare, "a property here");
lines.push(Object.keys(bare).join(), above(bare));
console.log(lines.join("\n"));
