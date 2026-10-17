// The pairs of Object.entries are never made where a loop reads them by an index that is below the length and takes them apart at once.
// IR= 1 byIndex RShift
// IR= 2 lengthInTheTest RShift
// IR= 1 pairInAVariable RShift
// IR= 1 whileLoop RShift
// IR= 1 everyOther RShift
// IR= 2 twoLists RShift
// IR= 1 changedMeanwhile RShift
// IR= 1 withGetters RShift
// IR= 1 byPattern RShift
// IR= 1 patternWithDefaults RShift
// IR= 0 byPattern NewArray|IteratorOpen
// IR= 1 patternWithRest RShift
// IR= 0 byIndex NewArray
// IR= 0 lengthInTheTest NewArray
// IR= 0 pairInAVariable NewArray
// IR= 0 whileLoop NewArray
// IR= 0 everyOther NewArray
// IR= 0 twoLists NewArray
// IR= 0 changedMeanwhile NewArray
// IR= 0 pastTheEnd RShift
// IR= 0 oneAhead RShift
// IR= 0 backwards RShift
// IR= 0 fromBelowZero RShift
// IR= 0 byFraction RShift
// IR= 0 anotherLength RShift
// IR= 0 sameEachTime RShift
// IR= 0 written RShift
// IR= 0 keepsPairs RShift
// IR= 0 keepsList RShift
// IR= 0 sorted i32 = RShift
// IR= 0 shortened RShift
let noise = 0;
let guard = 0;
function pad(k) { for (let i = 0; i < 3; i++) noise = (noise * 31 + k + i) % 1000003; }
function show(v) { pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); pad(7); pad(8); if (guard > 1e9) noise += show(v).length; return typeof v === "object" ? JSON.stringify(v) : String(v); }
const kept = [];

function byIndex(o) { if (guard > 1e9) byIndex(o); const entries = Object.entries(o); let out = ""; for (let i = 0, len = entries.length; i < len; i++) out += entries[i][0] + "=" + show(entries[i][1]) + ";"; return out; }
function lengthInTheTest(o) { if (guard > 1e9) lengthInTheTest(o); const entries = Object.entries(o); let out = ""; for (let i = 0; i < entries.length; i++) { const key = entries[i][0]; const value = entries[i][1]; out += key + ":" + show(value) + ","; } return out + entries.length; }
function pairInAVariable(o) { if (guard > 1e9) pairInAVariable(o); const entries = Object.entries(o); let out = ""; for (let i = 0; i < entries.length; i++) { const pair = entries[i]; out += pair[0] + pair[1] + pair[2] + "|"; } return out; }
function whileLoop(o) { if (guard > 1e9) whileLoop(o); const entries = Object.entries(o); let i = 0; let out = ""; while (i < entries.length) { out += entries[i][0]; i += 1; } return out; }
function everyOther(o) { if (guard > 1e9) everyOther(o); const entries = Object.entries(o); let out = ""; for (let i = 0; i < entries.length; i += 2) out += entries[i][0] + entries[i][1]; return out; }
function twoLists(a, b) { if (guard > 1e9) twoLists(a, b); const first = Object.entries(a), second = Object.entries(b); let out = ""; for (let i = 0; i < first.length; i++) for (let j = 0; j < second.length; j++) out += first[i][0] + second[j][0] + (first[i][1] === second[j][1] ? "!" : "."); return out; }

function byPattern(o) { if (guard > 1e9) byPattern(o); const entries = Object.entries(o); let out = ""; for (let i = 0; i < entries.length; i++) { const [key, value] = entries[i]; out += key + "->" + show(value) + ";"; } return out; }
function patternWithDefaults(o) { if (guard > 1e9) patternWithDefaults(o); const entries = Object.entries(o); let out = ""; for (let i = 0; i < entries.length; i++) { const [key, value = "none", third = "no third"] = entries[i]; out += key + value + third + ";"; } return out; }
function patternWithRest(o) { if (guard > 1e9) patternWithRest(o); const entries = Object.entries(o); let out = ""; for (let i = 0; i < entries.length; i++) { const [key, ...rest] = entries[i]; kept.push(rest); out += key + rest.length + ";"; } kept.length = 0; return out; }

function pastTheEnd(o) { if (guard > 1e9) pastTheEnd(o); const entries = Object.entries(o); let out = ""; try { for (let i = 0; i <= entries.length; i++) out += entries[i][0]; } catch (e) { out += e instanceof TypeError ? "<TypeError>" : "<other>"; } return out; }
function oneAhead(o) { if (guard > 1e9) oneAhead(o); const entries = Object.entries(o); let out = ""; try { for (let i = 0; i < entries.length; i++) out += entries[i + 1][0]; } catch (e) { out += e instanceof TypeError ? "<TypeError>" : "<other>"; } return out; }
function backwards(o) { if (guard > 1e9) backwards(o); const entries = Object.entries(o); let out = ""; for (let i = entries.length - 1; i >= 0; i--) out += entries[i][0] + entries[i][1]; return out; }
function fromBelowZero(o) { if (guard > 1e9) fromBelowZero(o); const entries = Object.entries(o); let out = ""; try { for (let i = -1; i < entries.length; i++) out += entries[i][0]; } catch (e) { out += e instanceof TypeError ? "<TypeError>" : "<other>"; } return out; }
function byFraction(o) { if (guard > 1e9) byFraction(o); const entries = Object.entries(o); let out = ""; try { for (let i = 0; i < entries.length; i += 0.5) out += entries[i][0]; } catch (e) { out += e instanceof TypeError ? "<TypeError>" : "<other>"; } return out; }
function anotherLength(o, other) { if (guard > 1e9) anotherLength(o, other); const entries = Object.entries(o); let out = ""; try { for (let i = 0; i < other.length; i++) out += entries[i][0]; } catch (e) { out += e instanceof TypeError ? "<TypeError>" : "<other>"; } return out; }
function sameEachTime(o) { if (guard > 1e9) sameEachTime(o); const entries = Object.entries(o); let same = 0; for (let i = 0; i < entries.length; i++) if (entries[i] === entries[i]) same++; return same; }
function written(o) { if (guard > 1e9) written(o); const entries = Object.entries(o); let out = ""; for (let i = 0; i < entries.length; i++) { entries[i][1] = i; out += entries[i][0] + entries[i][1]; } return out; }
function keepsPairs(o) { if (guard > 1e9) keepsPairs(o); const entries = Object.entries(o); for (let i = 0; i < entries.length; i++) kept.push(entries[i]); let out = ""; for (const pair of kept) out += pair.join("~") + Array.isArray(pair); kept.length = 0; return out; }
function keepsList(o) { if (guard > 1e9) keepsList(o); const entries = Object.entries(o); kept.push(entries); let out = ""; for (let i = 0; i < entries.length; i++) out += entries[i][0]; out += kept[0].length + ":" + kept[0][0].length; kept.length = 0; return out; }
function sorted(o) { if (guard > 1e9) sorted(o); const entries = Object.entries(o); entries.sort((a, b) => (a[0] < b[0] ? 1 : -1)); let out = ""; for (let i = 0; i < entries.length; i++) out += entries[i][0]; return out; }
function shortened(o) { if (guard > 1e9) shortened(o); const entries = Object.entries(o); entries.length = 1; let out = ""; for (let i = 0; i < entries.length; i++) out += entries[i][0]; return out; }
function changedMeanwhile(o) { if (guard > 1e9) changedMeanwhile(o); const entries = Object.entries(o); let out = ""; for (let i = 0; i < entries.length; i++) { o.added = i; o[entries[i][0]] = "changed"; out += entries[i][0] + "=" + entries[i][1] + ";"; } return out + Object.keys(o).length; }
function withGetters() { const log = []; const o = { get a() { log.push("a"); return 1; }, b: 2, get c() { log.push("c"); return 3; } }; const entries = Object.entries(o); let out = ""; for (let i = 0; i < entries.length; i++) out += entries[i][0] + entries[i][1]; return out + log.join(""); }
function getterThrows() { const o = { a: 1, get b() { throw new RangeError("b"); }, c: 3 }; try { const entries = Object.entries(o); let out = ""; for (let i = 0; i < entries.length; i++) out += entries[i][0]; return out; } catch (e) { return e.message; } }
function ofOtherThings() { const out = []; for (const thing of ["ab", [5, 6], 7, true, new Map([[1, 2]]), Object.create({ inherited: 1 }), Object.defineProperty({ seen: 1 }, "hidden", { value: 2, enumerable: false }), { [Symbol("s")]: 1, z: 1, 2: "two", 1: "one" }, new Proxy({ p: 1, q: 2 }, { ownKeys() { return ["q", "p"]; } })]) { const entries = Object.entries(thing); let line = ""; for (let i = 0; i < entries.length; i++) line += entries[i][0] + "=" + entries[i][1] + ","; out.push(line); } return out.join("|"); }
function ofNothing(v) { try { const entries = Object.entries(v); let out = "none"; for (let i = 0; i < entries.length; i++) out += entries[i][0]; return out; } catch (e) { return e instanceof TypeError ? "TypeError" : "other"; } }
function* yieldsBetween(o) { const entries = Object.entries(o); for (let i = 0; i < entries.length; i++) { yield entries[i][0]; yield entries[i][1]; } }
async function awaitsBetween(o) { const entries = Object.entries(o); let out = ""; for (let i = 0; i < entries.length; i++) { const key = entries[i][0]; await null; out += key + entries[i][1]; } return out; }

const bags = [{ a: 1, b: "two", c: null }, { id: 7, name: "n", price: 3.5, tags: [1, 2], on: true, nested: { x: 1 } }, {}];
for (const bag of bags) console.log(byIndex(bag), lengthInTheTest(bag), pairInAVariable(bag), whileLoop(bag), everyOther(bag), twoLists(bag, bags[0]));
for (const bag of bags) console.log(byPattern(bag), patternWithDefaults({ u: undefined, ...bag }), patternWithRest(bag));
for (const bag of bags) console.log(pastTheEnd(bag), oneAhead(bag), backwards(bag), fromBelowZero(bag), byFraction(bag), anotherLength(bag, [1, 2, 3, 4]), sameEachTime(bag), written(bag));
for (const bag of bags) console.log(keepsPairs(bag), keepsList({ k: 1, ...bag }), sorted(bag), shortened({ k: 1, ...bag }), changedMeanwhile({ ...bag }));
console.log(withGetters(), getterThrows(), ofOtherThings(), ofNothing(null), ofNothing(undefined), ofNothing(0));
console.log([...yieldsBetween(bags[0])].join());
guard += noise > 1e12 ? 1 : 0;
awaitsBetween(bags[1]).then(console.log);
