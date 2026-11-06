// What `pair[0]` reads off a pair of Object.entries, of a Map or of entries() is its key, and `pair[1]` its value, until something changes the pair.
// IR= 0 byIndex TypeTest
// IR= 0 pairInAVariable TypeTest
// IR= 0 ofAMap TypeTest
// IR= 0 ofAList TypeTest
let guard = 0;
const kept = [];

function byIndex(o) { if (guard > 1e9) byIndex(o); const entries = Object.entries(o); let total = 0; for (let i = 0; i < entries.length; i++) total += entries[i][0].length + entries[i][1]; return total; }
function pairInAVariable(o) { if (guard > 1e9) pairInAVariable(o); let total = 0; for (const pair of Object.entries(o)) total += pair[0].length * 10 + pair[1]; return total; }
function ofAMap(map) { if (guard > 1e9) ofAMap(map); let total = 0; for (const pair of map) total += pair[0].length * 100 + pair[1]; return total; }
function ofAList(list) { if (guard > 1e9) ofAList(list); let total = 0; for (const pair of list.entries()) total += pair[0] * 1000 + pair[1].length; return total; }
function written(text, n) { if (guard > 1e9) written(text, n); let total = 0; for (const pair of [[text, n], ["four", n / 2]]) total += pair[0].length + pair[1]; return total; }
function inCallbacks(o) { if (guard > 1e9) inCallbacks(o); return Object.entries(o).sort((a, b) => b[1] - a[1]).map(pair => pair[0] + "=" + pair[1] * 2).join(); }
function pastTheSecond(o) { if (guard > 1e9) pastTheSecond(o); let out = ""; for (const pair of Object.entries(o)) out += typeof pair[2] + typeof pair[-1] + typeof pair["1"] + typeof pair[1.5] + ";"; return out; }
function atAPositionOfRunTime(o, i) { if (guard > 1e9) atAPositionOfRunTime(o, i); let out = ""; for (const pair of Object.entries(o)) out += typeof pair[i] + ";"; return out; }

// Each case has a call of Object.entries and a written pair of its own, and reads them itself: what one case does to its pairs says nothing of another's.
function show(kindOfKey, key, kindOfValue, value, length) { return kindOfKey + ":" + String(key) + " " + kindOfValue + ":" + String(value) + " " + length; }

function untouched(o) { const pair = Object.entries(o)[0], own = ["w", o.a]; return show(typeof pair[0], pair[0], typeof pair[1], pair[1], pair.length) + " , " + show(typeof own[0], own[0], typeof own[1], own[1], own.length); }
function stored(o) { const pair = Object.entries(o)[0], own = ["w", o.a]; pair[1] = "stored"; own[1] = "stored"; return show(typeof pair[0], pair[0], typeof pair[1], pair[1], pair.length) + " , " + show(typeof own[0], own[0], typeof own[1], own[1], own.length); }
function storedAtTheKey(o) { const pair = Object.entries(o)[0], own = ["w", o.a]; pair[0] = 7; own[0] = 7; return show(typeof pair[0], pair[0], typeof pair[1], pair[1], pair.length) + " , " + show(typeof own[0], own[0], typeof own[1], own[1], own.length); }
function storedAtAPositionOfRunTime(o, i) { const pair = Object.entries(o)[0], own = ["w", o.a]; pair[i] = null; own[i] = null; return show(typeof pair[0], pair[0], typeof pair[1], pair[1], pair.length) + " , " + show(typeof own[0], own[0], typeof own[1], own[1], own.length); }
function swapped(o) { const pair = Object.entries(o)[0], own = ["w", o.a]; [pair[0], pair[1]] = [pair[1], pair[0]]; [own[0], own[1]] = [own[1], own[0]]; return show(typeof pair[0], pair[0], typeof pair[1], pair[1], pair.length) + " , " + show(typeof own[0], own[0], typeof own[1], own[1], own.length); }
function reversed(o) { const pair = Object.entries(o)[0], own = ["w", o.a]; pair.reverse(); own.reverse(); return show(typeof pair[0], pair[0], typeof pair[1], pair[1], pair.length) + " , " + show(typeof own[0], own[0], typeof own[1], own[1], own.length); }
function popped(o) { const pair = Object.entries(o)[0], own = ["w", o.a]; pair.pop(); own.pop(); return show(typeof pair[0], pair[0], typeof pair[1], pair[1], pair.length) + " , " + show(typeof own[0], own[0], typeof own[1], own[1], own.length); }
function shifted(o) { const pair = Object.entries(o)[0], own = ["w", o.a]; pair.shift(); own.shift(); return show(typeof pair[0], pair[0], typeof pair[1], pair[1], pair.length) + " , " + show(typeof own[0], own[0], typeof own[1], own[1], own.length); }
function unshifted(o) { const pair = Object.entries(o)[0], own = ["w", o.a]; pair.unshift(true); own.unshift(true); return show(typeof pair[0], pair[0], typeof pair[1], pair[1], pair.length) + " , " + show(typeof own[0], own[0], typeof own[1], own[1], own.length); }
function spliced(o) { const pair = Object.entries(o)[0], own = ["w", o.a]; pair.splice(0, 1, 1n, 2n); own.splice(0, 1, 1n, 2n); return show(typeof pair[0], pair[0], typeof pair[1], pair[1], pair.length) + " , " + show(typeof own[0], own[0], typeof own[1], own[1], own.length); }
function filled(o) { const pair = Object.entries(o)[0], own = ["w", o.a]; pair.fill(false); own.fill(false); return show(typeof pair[0], pair[0], typeof pair[1], pair[1], pair.length) + " , " + show(typeof own[0], own[0], typeof own[1], own[1], own.length); }
function copiedWithin(o) { const pair = Object.entries(o)[0], own = ["w", o.a]; pair.copyWithin(0, 1); own.copyWithin(0, 1); return show(typeof pair[0], pair[0], typeof pair[1], pair[1], pair.length) + " , " + show(typeof own[0], own[0], typeof own[1], own[1], own.length); }
function sortedInPlace(o) { const pair = Object.entries(o)[0], own = ["w", o.a]; pair.sort(); own.sort(); return show(typeof pair[0], pair[0], typeof pair[1], pair[1], pair.length) + " , " + show(typeof own[0], own[0], typeof own[1], own[1], own.length); }
function cutShort(o) { const pair = Object.entries(o)[0], own = ["w", o.a]; pair.length = 1; own.length = 1; return show(typeof pair[0], pair[0], typeof pair[1], pair[1], pair.length) + " , " + show(typeof own[0], own[0], typeof own[1], own[1], own.length); }
function deleted(o) { const pair = Object.entries(o)[0], own = ["w", o.a]; delete pair[1]; delete own[1]; return show(typeof pair[0], pair[0], typeof pair[1], pair[1], pair.length) + " , " + show(typeof own[0], own[0], typeof own[1], own[1], own.length); }
function defined(o) { const pair = Object.entries(o)[0], own = ["w", o.a]; for (const list of [pair, own]) Object.defineProperty(list, 1, { get() { return "from a getter"; } }); return show(typeof pair[0], pair[0], typeof pair[1], pair[1], pair.length) + " , " + show(typeof own[0], own[0], typeof own[1], own[1], own.length); }
function assigned(o) { const pair = Object.entries(o)[0], own = ["w", o.a]; Object.assign(pair, { 0: undefined, 1: Symbol.iterator }); Object.assign(own, { 0: undefined, 1: Symbol.iterator }); return show(typeof pair[0], pair[0], typeof pair[1], pair[1], pair.length) + " , " + show(typeof own[0], own[0], typeof own[1], own[1], own.length); }
function setByReflect(o) { const pair = Object.entries(o)[0], own = ["w", o.a]; Reflect.set(pair, 1, "by Reflect"); Reflect.set(own, 0, 0.5); return show(typeof pair[0], pair[0], typeof pair[1], pair[1], pair.length) + " , " + show(typeof own[0], own[0], typeof own[1], own[1], own.length); }
function changedElsewhere(o) { const pair = Object.entries(o)[0], own = ["w", o.a]; kept.push(pair, own); kept[kept.length - 1][1] = "elsewhere"; kept[kept.length - 2][0] = null; return show(typeof pair[0], pair[0], typeof pair[1], pair[1], pair.length) + " , " + show(typeof own[0], own[0], typeof own[1], own[1], own.length); }
function changedByACallee(o) { const pair = Object.entries(o)[0], own = ["w", o.a]; const change = list => { list[0] = list.length; }; change(pair); change(own); return show(typeof pair[0], pair[0], typeof pair[1], pair[1], pair.length) + " , " + show(typeof own[0], own[0], typeof own[1], own[1], own.length); }
function stepOfAMapChanged(map) { let out = ""; for (const pair of map) { pair.reverse(); out += show(typeof pair[0], pair[0], typeof pair[1], pair[1], pair.length) + ";"; } return out; }
function oneOfTwoKinds(o, takesOwn) { const pair = takesOwn ? [1, "own"] : Object.entries(o)[0]; return show(typeof pair[0], pair[0], typeof pair[1], pair[1], pair.length); }
function pairOrText(o, takesText) { const pair = takesText ? "text" : Object.entries(o)[0]; return show(typeof pair[0], pair[0], typeof pair[1], pair[1], pair.length); }
function restOfAPair(o) { const [...all] = Object.entries(o)[0], [...ownRest] = ["w", o.a]; return show(typeof all[0], all[0], typeof all[1], all[1], all.length) + " , " + show(typeof ownRest[0], ownRest[0], typeof ownRest[1], ownRest[1], ownRest.length); }
function copyOfAPair(o) { const copy = [...Object.entries(o)[0]], sliced = Object.entries(o)[0].slice(1); return show(typeof copy[0], copy[0], typeof copy[1], copy[1], copy.length) + " , " + show(typeof sliced[0], sliced[0], typeof sliced[1], sliced[1], sliced.length); }
function pairOrNothing(o, i) { try { const pair = Object.entries(o)[i]; return show(typeof pair[0], pair[0], typeof pair[1], pair[1], pair.length); } catch (error) { return error.constructor.name; } }

const point = { x: 1, y: 2.5 };
const held = { left: 4, right: 5.5 };
const counts = new Map([["one", 1], ["three", 3.5]]);
const words = ["a", "bcd"];
let total = 0;
for (let n = 0; n < 20; n++) { point.x = n & 7; held.left = n; total += byIndex(point) + pairInAVariable(held) + ofAMap(counts) + ofAList(words) + written("ab", n); }
console.log(total, byIndex(point), pairInAVariable(held), ofAMap(counts), ofAList(words), written("abc", 3));
console.log(inCallbacks({ low: 1, high: 3, middle: 2 }), pastTheSecond({ p: 1, q: "two" }));
console.log(atAPositionOfRunTime({ p: 1, q: true }, 0), atAPositionOfRunTime({ p: 1, q: true }, 1), atAPositionOfRunTime({ p: 1, q: true }, 2), atAPositionOfRunTime({ p: 1, q: true }, "length"));
for (const change of [untouched, stored, storedAtTheKey, swapped, reversed, popped, shifted, unshifted, spliced, filled, copiedWithin, sortedInPlace, cutShort, deleted, defined, assigned, setByReflect, changedElsewhere, changedByACallee, restOfAPair, copyOfAPair])
  console.log(change.name, "|", change({ a: 1 }));
console.log(storedAtAPositionOfRunTime({ a: 1 }, 0), "|", storedAtAPositionOfRunTime({ a: 1 }, 1), "|", storedAtAPositionOfRunTime({ a: 1 }, 2));
console.log(stepOfAMapChanged(counts), "|", oneOfTwoKinds({ a: 1 }, true), "|", oneOfTwoKinds({ a: 1 }, false));
console.log(pairOrText({ a: 1 }, true), "|", pairOrText({ a: 1 }, false), "|", pairOrNothing({ a: 1 }, 0), "|", pairOrNothing({ a: 1 }, 1));
guard += total > 1e12 ? 1 : 0;
