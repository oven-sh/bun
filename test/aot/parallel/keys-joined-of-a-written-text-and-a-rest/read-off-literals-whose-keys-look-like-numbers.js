const shift = { "-1": "left", "0": "stay", "1": "right" };
function word(sign, n) { return shift[sign + n]; }
function back(n) { return shift["-" + n]; }
console.log(word("", 1), back(process.argv.length > 9 ? 2 : 1));
const spacing = { "-1": "-0.25rem", "-2": "-0.5rem", "-4": "-1rem", "-px": "-1px" };
function margin(step) { const v = spacing["-" + step]; return v ? "margin: " + v : "none"; }
const out = [];
for (const step of ["1", "2", "4", "px", "9"]) out.push(margin(step));
console.log(out.join("; "));
const table = { "-1": "stored", "-v": "other" };
const n = process.argv.length > 9 ? "x" : "1";
const v = table["-" + n];
console.log(v ? v + "!" : "none");
const actions = { "-1": () => 6, "-v": () => 2 };
function run(letter) { return actions["-" + letter]?.(); }
const got = [];
for (const letter of ["1", "v", "z"]) got.push(String(run(letter)));
console.log(got.join(" "));
const odd = { NaN: "stored", Name: "" };
const rest = process.argv.length > 9 ? "ame" : "aN";
console.log(odd["N" + rest] ? "found" : "missing");
