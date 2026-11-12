// Regular expressions that a const, a variable or a capture holds, matched in loops: lastIndex of every kind, sticky, global, compiled anew, frozen, with a name of its own. What is printed is what plain Bun prints.
const unseen = x => [x][JSON.parse("0")];
const subjects = unseen(["ab", "xab", "aab b", "", "12 ab 34", "AB", "abĀ", ("zzabab").slice(2), "a1b2c3", "x".repeat(70) + "ab"]);
let log = "";
const PLAIN = /a(b)?/;
var VARIABLE = /^a+b/;
const GLOBAL = /[ab]/g;
const STICKY = /[a-z]+|\d+|./y;
const makeCapture = () => { const held = /(\d)|b/; const all = /\w/g; return { test: list => { let t = ""; for (const s of list) t += held.test(s) ? 1 : 0; return t; }, count: list => { let n = 0; for (const s of list) { all.lastIndex = 0; while (all.test(s)) n++; } return n; }, held, all }; };
const capture = makeCapture();
function ask(list) {
  let t = "";
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    t += (PLAIN.test(s) ? 1 : 0) + "" + (VARIABLE.test(s) ? 1 : 0) + s.search(PLAIN) + s.search(GLOBAL);
    const m = PLAIN.exec(s);
    t += m ? m[0] + m[1] + m.index + m.input.length : "-";
    const n = s.match(VARIABLE);
    t += n ? n[0] + n.length : "-";
    t += "," + s.replace(VARIABLE, "<>") + "," + s.replace(GLOBAL, "") + "," + s.replace(GLOBAL, "$&$&") + "," + GLOBAL.lastIndex + ";";
  }
  return t;
}
function scan(list) {
  let t = "";
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    let at = 0;
    while (at < s.length) { STICKY.lastIndex = at; const m = STICKY.exec(s); if (m === null) break; t += m[0].length + "."; at = STICKY.lastIndex; }
    GLOBAL.lastIndex = 1;
    while (GLOBAL.test(s)) t += GLOBAL.lastIndex;
    t += GLOBAL.lastIndex + ";";
  }
  return t;
}
console.log(ask(subjects));
console.log(scan(subjects));
console.log(capture.test(subjects), capture.count(subjects));
for (const last of unseen([0, 1, 100, -1, 1.5, NaN, 2 ** 31, "1", null, { valueOf() { log += "valueOf "; return 1; } }])) {
  GLOBAL.lastIndex = last; PLAIN.lastIndex = last; STICKY.lastIndex = last; capture.all.lastIndex = last; capture.held.lastIndex = last;
  let t = "";
  for (let i = 0; i < 3; i++) { try { t += (GLOBAL.test("xab") ? 1 : 0) + String(GLOBAL.lastIndex) + (PLAIN.test("xab") ? 1 : 0) + (STICKY.exec("xab") + "") + String(STICKY.lastIndex) + capture.test(["x1"]); } catch (error) { t += error.constructor.name; } }
  console.log(String(typeof last), t, log);
  log = "";
}
PLAIN.lastIndex = 0; GLOBAL.lastIndex = 0; STICKY.lastIndex = 0; capture.held.lastIndex = 0; capture.all.lastIndex = 0;
Object.defineProperty(GLOBAL, "lastIndex", { writable: false, value: 0 });
for (let i = 0; i < 2; i++) for (const act of [() => GLOBAL.test("ab"), () => GLOBAL.test("--"), () => "ab".replace(GLOBAL, ""), () => "--".replace(GLOBAL, ""), () => "ab".search(GLOBAL)]) { try { console.log(act()); } catch (error) { console.log(error.constructor.name); } }
VARIABLE.exec = function () { log += "own "; return null; };
console.log(VARIABLE.test("ab"), "ab".match(VARIABLE), log);
delete VARIABLE.exec;
console.log(VARIABLE.test("ab"), "ab".match(VARIABLE)[0]);
VARIABLE = /q/;
console.log(VARIABLE.test("ab"), "aq".search(VARIABLE));
capture.held.compile("^x", "i");
console.log(capture.test(subjects), capture.test(unseen(["Xa", "ax", "x1"])));
PLAIN.compile("b+(a)?", "g");
for (let i = 0; i < 3; i++) console.log(PLAIN.test("abba"), PLAIN.lastIndex, PLAIN.exec("bba"), "abba".replace(PLAIN, "."));
