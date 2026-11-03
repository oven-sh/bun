// `typeof value > "u"` is how minifiers write `typeof value === "undefined"`: every order of typeof against a written text answers as the comparison of the two texts does.
const values = [undefined, null, true, 0, 1.5, "", "u", Symbol("s"), 10n, function () {}, () => 1, class {}, {}, [], new Date(0), /x/];
let missing;

function greater(v) { return typeof v > "u"; }
function less(v) { return typeof v < "u"; }
function greaterOrEqual(v) { return typeof v >= "u"; }
function lessOrEqual(v) { return typeof v <= "u"; }
function boundFirstLess(v) { return "u" < typeof v; }
function boundFirstGreater(v) { return "u" > typeof v; }
function boundFirstLessOrEqual(v) { return "u" <= typeof v; }
function boundFirstGreaterOrEqual(v) { return "u" >= typeof v; }
function onlyBigint(v) { return typeof v < "bo"; }
function allButBigint(v) { return typeof v >= "bo"; }
function exactlyUndefined(v) { return typeof v >= "undefined"; }
function aboveUndefined(v) { return typeof v > "undefined"; }
function twoNames(v) { return typeof v > "sym"; }
function belowAll(v) { return typeof v < "a"; }
function aboveAll(v) { return typeof v > ""; }
function notLatin(v) { return typeof v < "ü"; }
function astral(v) { return typeof v > "\u{1f600}"; }
function onlyObject(v) { return typeof v > "number" && typeof v < "string" ? "object" : "other"; }
function allButObject(v) { return typeof v <= "o" || typeof v >= "s"; }
function narrowed(v) { return typeof v > "u" ? 7 : v; }
function narrowedAway(v) { return typeof v < "u" ? v : 7; }
function kept(v) { const kind = typeof v; return kind > "u" ? "none" : kind; }
function free() { return [typeof neverDeclaredAnywhere > "u", typeof neverDeclaredAnywhere < "u", typeof globalThis < "u", typeof missing > "u"]; }
function inALoop(list) { let n = 0; for (let i = 0; i < list.length; i++) if (typeof list[i] < "u") n++; return n; }
function once(list) { let calls = 0; const next = () => list[calls++]; const answers = []; while (calls < list.length) answers.push(typeof next() > "u"); return [calls, answers.join()]; }
function deadZone() { try { const answer = typeof later > "u"; let later = 1; return [answer, later]; } catch (error) { return error.constructor.name; } }

const asked = [greater, less, greaterOrEqual, lessOrEqual, boundFirstLess, boundFirstGreater, boundFirstLessOrEqual, boundFirstGreaterOrEqual, onlyBigint, allButBigint,
  exactlyUndefined, aboveUndefined, twoNames, belowAll, aboveAll, notLatin, astral, onlyObject, allButObject, kept];
for (const ask of asked) console.log(ask.name, values.map(v => String(ask(v))).join(" "));
for (const ask of [narrowed, narrowedAway]) console.log(ask.name, values.map(v => typeof ask(v)).join(" "));
console.log(free().join(" "), inALoop(values), once(values).join(" "), deadZone());
