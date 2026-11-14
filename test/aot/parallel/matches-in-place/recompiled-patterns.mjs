// Regular expressions that loops match in place are compiled anew, frozen, given lastIndex of every kind and methods of their own between the loops.
const subjects = ["alpha-12", "beta", "x = 1042;", "https://a.b/c", "foo.test.ts", "  indent", "Zeta_9", "2026-11-10"];
const CONST = /^[a-z]+-\d+$/;
const SUFFIX = /\.tsx?$/;
const GLOBAL = /[a-c]/g;
const STICKY = /[a-z]+/y;
var VARIABLE = /\d\d/;
function countConst(list) { let sum = 0; for (let i = 0; i < list.length; i++) { const s = list[i]; sum += CONST.test(s) ? 1 << i : 0; } return sum; }
function countSuffix(list) { let sum = 0; for (let i = 0; i < list.length; i++) { const s = list[i]; sum += SUFFIX.test(s) ? 1 << i : 0; } return sum; }
function countVariable(list) { let sum = 0; for (let i = 0; i < list.length; i++) { const s = list[i]; sum += VARIABLE.test(s) ? 1 << i : 0; } return sum; }
function countGlobal(list) { let sum = 0; for (let i = 0; i < list.length; i++) { const s = list[i]; GLOBAL.lastIndex = 0; while (GLOBAL.test(s)) sum += GLOBAL.lastIndex; } return sum; }
function countSticky(list) { let sum = 0; for (let i = 0; i < list.length; i++) { const s = list[i]; STICKY.lastIndex = 1; const found = STICKY.exec(s); if (found) sum += found[0].length * (i + 1); } return sum; }
function countSearch(list) { let sum = 0; for (let i = 0; i < list.length; i++) { const s = list[i]; sum += s.search(VARIABLE) * (i + 1); } return sum; }
function countMatch(list) { let sum = 0; for (let i = 0; i < list.length; i++) { const s = list[i]; const found = s.match(CONST); if (found) sum += found[0].length * (i + 1); } return sum; }
const makeCounter = () => { const held = /^[a-z]/; const count = list => { let sum = 0; for (let i = 0; i < list.length; i++) { const s = list[i]; sum += held.test(s) ? 1 << i : 0; } return sum; }; return { held, count }; };
const counter = makeCounter();
const all = () => console.log(countConst(subjects), countSuffix(subjects), countVariable(subjects), countGlobal(subjects), countSticky(subjects), countSearch(subjects), countMatch(subjects), counter.count(subjects));
all();
for (const held of [CONST, SUFFIX, GLOBAL, STICKY, VARIABLE, counter.held]) { held.compile(held.source === "\\d\\d" ? "[xZ]" : "e", held.flags); all(); }
CONST.compile("\\d$", "g"); all(); all();
STICKY.compile("[a-z]", ""); all();
SUFFIX.lastIndex = 5; CONST.lastIndex = "1"; all(); CONST.lastIndex = { valueOf() { console.log("asked"); return 0; } }; console.log(countConst(subjects.slice(0, 2)));
CONST.lastIndex = 0; Object.freeze(GLOBAL); try { console.log(countGlobal(subjects)); } catch (error) { console.log(error.constructor.name); }
VARIABLE.exec = () => null; console.log(countVariable(subjects), countSearch(subjects)); delete VARIABLE.exec;
const makePair = () => { const held = /^[a-z]+-\d+$/; const turn = list => { let sum = 0; for (let i = 0; i < list.length; i++) { const s = list[i]; sum += held.test(s) ? 1 << i : 0; } return sum; }; return { held, turn }; };
const pair = makePair();
const makeHidden = () => { const held = /^[a-z]+-\d+$/; function turn(list) { let sum = 0; for (let i = 0; i < list.length; i++) { const s = list[i]; sum += held.test(s) ? 1 << i : 0; } return sum; } return { turn, again() { held.compile("e"); } }; };
const hidden = makeHidden();
console.log(pair.turn(subjects), hidden.turn(subjects));
pair.held.compile("e"); console.log(pair.turn(subjects), hidden.turn(subjects));
hidden.again(); console.log(pair.turn(subjects), hidden.turn(subjects));
pair.held.compile("[0-9]$", "y"); for (let i = 0; i < 3; i++) console.log(pair.turn(subjects), pair.held.lastIndex);
