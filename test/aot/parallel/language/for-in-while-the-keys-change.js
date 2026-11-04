const report = value => console.log(typeof value === "string" ? value : String(value));
// What a turn does to the object that is enumerated: a key that is deleted before its turn is passed over, a key that is added may or may not come, none comes twice.
function tell(title, act) { let outcome; try { outcome = act(); } catch (error) { outcome = error.name; } report(title + ": " + outcome); }
function deleting(o, at, gone) { let text = ""; for (const k in o) { text += k; if (k === at) delete o[gone]; } return text; }
function adding(o, at, name) { let text = ""; let turns = 0; for (const k in o) { text += k; if (k === at) o[name] = 1; if (++turns > 50) return "too many turns"; } return text.includes(at) + " " + (text.split(at).length - 1); }
function readding(o, at, name) { let text = ""; for (const k in o) { text += k; if (k === at) { delete o[name]; o[name] = 2; } } return text.split(name).length - 1 <= 1; }
function addingEachTurn(o) { let turns = 0; for (const k in o) { o["new" + turns] = 1; if (++turns > 50) return "too many turns"; } return turns; }
function growingList(list) { let turns = 0; for (const k in list) { list.push(k); if (++turns > 50) return "too many turns"; } return turns; }
function shrinkingList(list) { let text = ""; for (const k in list) { text += k; list.length = 1; } return text; }
function nestedOverSame(o) { let text = ""; for (const a in o) { for (const b in o) text += a + b; text += ";"; } return text; }
function nestedDeleting(o) { let text = ""; for (const a in o) { for (const b in o) { text += a + b; if (b === "b") delete o.c; } text += ";"; } return text; }
function above(o, parent, at, gone) { let text = ""; for (const k in o) { text += k; if (k === at) delete parent[gone]; } return text; }
function shadowing(o, at, name) { let text = ""; for (const k in o) { text += k; if (k === at) Object.defineProperty(o, name, { value: 1, enumerable: false, configurable: true }); } return text; }
function reparenting(o, at, parent) { let text = ""; for (const k in o) { text += k; if (k === at) Object.setPrototypeOf(o, parent); } return text.startsWith("ab"); }
tell("a later key is deleted", () => deleting({ a: 1, b: 2, c: 3 }, "a", "b"));
tell("an earlier key is deleted", () => deleting({ a: 1, b: 2, c: 3 }, "b", "a"));
tell("its own key is deleted", () => deleting({ a: 1, b: 2, c: 3 }, "b", "b"));
tell("the last key is deleted", () => deleting({ a: 1, b: 2, c: 3 }, "a", "c"));
tell("a key is added", () => adding({ a: 1, b: 2 }, "a", "z"));
tell("a key is added in the last turn", () => adding({ a: 1, b: 2 }, "b", "z"));
tell("a key is deleted and added again", () => readding({ a: 1, b: 2, c: 3 }, "a", "c"));
tell("a key is added in every turn", () => addingEachTurn({ a: 1, b: 2, c: 3 }));
tell("a list grows", () => growingList([1, 2, 3]));
tell("a list shrinks", () => shrinkingList([1, 2, 3]));
tell("an element is deleted", () => deleting([1, 2, 3], "0", "1"));
tell("nested over the same object", () => nestedOverSame({ a: 1, b: 2 }));
tell("nested, the inner one deletes", () => nestedDeleting({ a: 1, b: 2, c: 3 }));
tell("a key above is deleted", () => { const parent = { up: 1, over: 2 }; const o = Object.create(parent); o.a = 1; o.b = 2; return above(o, parent, "a", "over"); });
tell("a key above is hidden by one that is not listed", () => { const o = Object.create({ up: 1 }); o.a = 1; return shadowing(o, "a", "up"); });
tell("the object gets another prototype", () => reparenting({ a: 1, b: 2 }, "a", { late: 1 }));
tell("an instance of a class", () => { class Pair { first = 1; second = 2; } return deleting(new Pair(), "first", "second"); });
tell("parsed data", () => deleting(JSON.parse('{"a":1,"b":2,"c":3}'), "a", "b"));
tell("a map of names without a prototype", () => { const o = Object.create(null); o.a = 1; o.b = 2; o.c = 3; return deleting(o, "a", "b"); });
tell("keys that are numbers and names", () => deleting({ b: 1, 1: 2, a: 3, 0: 4 }, "0", "a"));
tell("a typed array", () => { let text = ""; for (const k in new Uint8Array(3)) text += k; return text; });
tell("arguments", () => (function () { return deleting(arguments, "0", "1"); })(1, 2, 3));
tell("a function with properties", () => { const f = function () {}; f.a = 1; f.b = 2; return deleting(f, "a", "b"); });
tell("a proxy", () => deleting(new Proxy({ a: 1, b: 2, c: 3 }, {}), "a", "b"));
tell("a frozen object", () => { "use strict"; return deleting(Object.freeze({ a: 1, b: 2 }), "a", "b"); });
report("end");
