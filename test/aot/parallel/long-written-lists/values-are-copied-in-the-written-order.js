// A written list of more than sixteen values that are not constants is made by the run time out of a buffer of its values.
// Where its storage holds any value the values are copied straight. Every list below is born so, those of computed whole numbers and fractions too.
// Every evaluation gives a new list, in the written order, and the collector sees every element.
// COUNT: operation:operationAOTNewArrayWithIndexingType >= 40
"use strict";
const seen = [];
function tell(name, list) { seen.push(name + " " + list.length + " " + list.map(show).join(",")); }
function show(v) { return v === undefined ? "undefined" : v === null ? "null" : typeof v === "bigint" ? v + "n" : typeof v === "symbol" ? v.description : typeof v === "function" ? "fn:" + v.name : typeof v === "object" ? (Array.isArray(v) ? "[" + v.map(show).join("|") + "]" : "{" + Object.keys(v).map(k => k + ":" + show(v[k])).join("|") + "}") : Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : String(v); }
function ofObjects(i) { return [{ at: i + 0 }, { at: i + 1 }, { at: i + 2 }, { at: i + 3 }, { at: i + 4 }, { at: i + 5 }, { at: i + 6 }, { at: i + 7 }, { at: i + 8 }, { at: i + 9 }, { at: i + 10 }, { at: i + 11 }, { at: i + 12 }, { at: i + 13 }, { at: i + 14 }, { at: i + 15 }, { at: i + 16 }]; }
function ofTexts(i) { return ["t" + (i + 0), "t" + (i + 1), "t" + (i + 2), "t" + (i + 3), "t" + (i + 4), "t" + (i + 5), "t" + (i + 6), "t" + (i + 7), "t" + (i + 8), "t" + (i + 9), "t" + (i + 10), "t" + (i + 11), "t" + (i + 12), "t" + (i + 13), "t" + (i + 14), "t" + (i + 15), "t" + (i + 16), "t" + (i + 17)]; }
const mark = Symbol("mark");
function mixed(i) { return [i, i + 0.5, "s" + i, null, undefined, i > 1, { i }, [i, i], -0 * (i + 1), NaN, BigInt(i), mark, show, i * 1e10, "" + i, Infinity, -i, i % 2 ? "odd" : 7, void 0, [[i]]]; }
function ofLists(i) { return [["a0", i], ["a1", i], ["a2", i], ["a3", i], ["a4", i], ["a5", i], ["a6", i], ["a7", i], ["a8", i], ["a9", i], ["a10", i], ["a11", i], ["a12", i], ["a13", i], ["a14", i], ["a15", i], ["a16", i], ["a17", i], ["a18", i], ["a19", i], ["a20", i], ["a21", i], ["a22", i], ["a23", i], ["a24", i], ["a25", i], ["a26", i], ["a27", i], ["a28", i], ["a29", i], ["a30", i], ["a31", i], ["a32", i]]; }
function ofParameters(a, b, c) { return [a, b, c, a, b, c, a, b, c, a, b, c, a, b, c, a, b, c, a, b, c]; }
function wholeNumbers(i) { return [i + 0, i + 1, i + 2, i + 3, i + 4, i + 5, i + 6, i + 7, i + 8, i + 9, i + 10, i + 11, i + 12, i + 13, i + 14, i + 15, i + 16, i + 17, i + 18]; }
function fractions(i) { return [i + 0.25, i + 1.25, i + 2.25, i + 3.25, i + 4.25, i + 5.25, i + 6.25, i + 7.25, i + 8.25, i + 9.25, i + 10.25, i + 11.25, i + 12.25, i + 13.25, i + 14.25, i + 15.25, i + 16.25, i + 17.25, i + 18.25]; }
function wholeNumbersButOne(i, odd) { return [i + 0, i + 1, i + 2, i + 3, i + 4, i + 5, i + 6, i + 7, i + 8, i + 9, i + 10, i + 11, i + 12, i + 13, i + 14, i + 15, i + 16, i + 17, odd]; }
function fractionsButOne(i, odd) { return [i + 0.5, i + 1.5, i + 2.5, i + 3.5, i + 4.5, i + 5.5, i + 6.5, i + 7.5, i + 8.5, i + 9.5, i + 10.5, i + 11.5, i + 12.5, i + 13.5, i + 14.5, i + 15.5, i + 16.5, i + 17.5, odd]; }
for (let i = 0; i < 3; i++) { tell("objects", ofObjects(i)); tell("texts", ofTexts(i)); tell("mixed", mixed(i)); tell("lists", ofLists(i)); tell("parameters", ofParameters(i, "p" + i, { i })); tell("whole", wholeNumbers(i)); tell("fractions", fractions(i)); tell("whole but a text", wholeNumbersButOne(i, "x")); tell("whole but a fraction", wholeNumbersButOne(i, 0.5)); tell("whole but an object", wholeNumbersButOne(i, { i })); tell("fractions but NaN", fractionsButOne(i, NaN)); tell("fractions but undefined", fractionsButOne(i, undefined)); tell("fractions but a list", fractionsButOne(i, [i])); }
const first = ofObjects(1), second = ofObjects(1);
first[0] = "written"; first.push("pushed"); first.length = 19; second.reverse();
tell("the first, written into", first); tell("the second, turned round", second); tell("a third", ofObjects(1));
tell("frozen", Object.freeze(ofTexts(5))); tell("spread", [...ofTexts(6), ...ofParameters(1, 2, 3)]);
function acrossCollections(n) { const kept = []; let sum = 0; for (let i = 0; i < n; i++) { const list = ofObjects(i); if (i % 997 === 0) kept.push(list); sum += list[16].at - list[0].at + ofLists(i)[32][1]; if (i % 5000 === 0) Bun.gc(true); } for (const list of kept) for (let k = 0; k < 17; k++) sum += list[k].at; return sum + " " + kept.length; }
seen.push("across collections " + acrossCollections(30000));
console.log(seen.join("\n"));
