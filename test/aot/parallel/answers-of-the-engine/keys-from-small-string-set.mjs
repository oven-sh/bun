// A key that is one of a few texts is held as the number of its literal. The same texts also come out of sums, slices, joins, walks over keys and parsed text.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
const table = { first: "one", second: "two", third: "three" };
function pick(key) { return table[key]; }
report(pick("first"));
report(pick("second"));
report(pick("third"));
function pickJoined(head, tail) { return table[head + tail]; }
report(pickJoined("fir", "st"));
report(pickJoined("sec", "ond"));
report(pickJoined("thi", "rd"));
report(pickJoined("four", "th"));
function walk() { let text = ""; for (const key in table) text += key === "second" ? "(" + table[key] + ")" : table[key]; return text; }
report(walk());
function listed() { const keys = Object.keys(table); let text = ""; for (let i = 0; i < keys.length; i++) text += keys[i] === "third" ? "!" : pick(keys[i]); return text; }
report(listed());
function kindOf(key) { switch (key) { case "first": return 1; case "second": return 2; case "third": return 3; default: return 0; } }
report(kindOf("first"));
report(kindOf("sec" + "ond"));
report(kindOf(["th", "ird"].join("")));
report(kindOf("fourth"));
report(kindOf("second".slice(0, 6)));
report(kindOf("xthird".slice(1)));
function isOneOf(key) { return key === "first" || key === "third"; }
report(isOneOf("first"));
report(isOneOf("second"));
report(isOneOf("thirdx".slice(0, 5)));
report(isOneOf(String("first")));
function getterFor(source, key) { return function () { return source[key]; }; }
report(getterFor(table, "first")());
report(getterFor(table, "second")());
report(getterFor(table, "thi" + "rd")());
function parsed(text) { const key = JSON.parse(text); return key === "second" ? table[key] : kindOf(key); }
report(parsed("\"second\""));
report(parsed("\"third\""));
report(parsed("\"other\""));
function lengthOf(key) { return key.length; }
report(lengthOf("first"));
report(lengthOf("second"));
report(lengthOf("third"));
function stored(key, value) { const made = { first: 0, second: 0 }; made[key] = value; return made.first + "," + made.second + "," + made[key]; }
report(stored("first", 1));
report(stored("second", 2));
report(stored("sec" + "ond", 3));
function templated(key) { return `${key}/${table[key]}`; }
report(templated("first"));
report(templated("third"));
report("end");
