const report = value => console.log(typeof value === "string" ? value : String(value));
// A for-in over a text: the keys are the places of its units, then whatever can be listed above it. Nothing else runs in such a loop, and each turn goes on from where the last one stood.
function count(o) { let n = 0; for (const k in o) n++; return n; }
function names(o) { let text = ""; for (const k in o) text += k + ","; return text; }
function units(o) { let text = ""; for (const k in o) text += o[k] + "|"; return text; }
function firstKey(o) { for (const k in o) return k; return "none"; }
function untilSecond(o) { let n = 0; for (const k in o) { if (++n === 2) break; } return n; }
function skipping(o) { let text = ""; for (const k in o) { if (k === "1") continue; text += k; } return text; }
function nested(o) { let n = 0; for (const a in o) for (const b in o) n++; return n; }
function nestedOverTwo(o, p) { let text = ""; for (const a in o) { for (const b in p) text += a + b; text += ";"; } return text; }
function twice(o) { let n = 0; for (const a in o) n++; for (const b in o) n += 10; return n; }
function inLoop(o) { let n = 0; for (let turn = 0; turn < 3; turn++) for (const k in o) n++; return n; }
function reassigned(o) { let text = ""; for (const k in o) { text += k; o = "longer than before"; } return text; }
function withTry(o) { let n = 0; for (const k in o) { try { if (k === "1") throw new Error("at " + k); n++; } catch (error) { n += 100; } } return n; }
function intoVariable(o) { var last; for (last in o); return last; }
function intoField(o) { const holder = { key: "none" }; for (holder.key in o); return holder.key; }
function* yielding(o) { for (const k in o) yield k; }
async function awaiting(o) { let text = ""; for (const k in o) text += await k; return text; }
report(count("abc")); report(count("")); report(count("a")); report(count("\u{1F600}")); report(count("x".repeat(1000)));
report(names("ab")); report(units("abc")); report(firstKey("abc")); report(firstKey("")); report(untilSecond("abcd")); report(skipping("abc"));
report(nested("abc")); report(nestedOverTwo("ab", "xyz")); report(twice("abc")); report(inLoop("ab")); report(reassigned("abc")); report(withTry("abc")); report(intoVariable("abc")); report(intoField("abc"));
report([...yielding("abc")].join());
let atTopLevel = 0; for (const k in "abcd") atTopLevel++; report(atTopLevel);
const joined = ["a", "b"].join("c"); let overJoined = ""; for (const k in joined) overJoined += k; report(overJoined);
const rope = "left" + String(atTopLevel) + "right"; report(count(rope));
report(count(`template ${atTopLevel}`)); report(count(String(12345))); report(count((12345).toString())); report(count("abc".slice(1))); report(count(typeof atTopLevel));
function countOfText(o) { let n = 0; for (const k in o) n++; return n; }
for (const text of ["", "a", "ab", "abc"]) report(countOfText(text));
function countOfTextOrNothing(o) { let n = 0; for (const k in o) n++; return n; }
for (const value of ["ab", undefined, null, "abc"]) report(countOfTextOrNothing(value));
function countOfPrimitive(o) { let n = 0; for (const k in o) n++; return n; }
for (const value of ["ab", 1, true, 1n, Symbol.iterator, undefined, null, 1.5, NaN]) report(countOfPrimitive(value));
function countOfAnything(o) { let n = 0; for (const k in o) n++; return n; }
for (const value of ["ab", [1, 2, 3], { a: 1 }, new String("abcd"), 7, null]) report(countOfAnything(value));
report(names(new String("ab"))); report(names(Object("ab"))); report(names(Object.assign(new String("ab"), { more: 1 })));
awaiting("abc").then((text) => { report(text); report("end"); });
