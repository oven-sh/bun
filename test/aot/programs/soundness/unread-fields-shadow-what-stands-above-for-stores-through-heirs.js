// Nobody reads the field of the object in the middle, yet it shadows what stands above it on the prototype chain: a store through an heir ends at it and makes an own property, and runs no setter and meets no read-only property further up.
"use strict";
function attempt(work) { try { return String(work()); } catch (error) { return error.name; } }
const log = [];
function row(name, work) { log.length = 0; const answer = attempt(work); console.log(name, "|", answer, "|", log.join()); }
row("literals", () => { const top = { set tag1(v) { log.push("setter " + v); }, get tag1() { return "top"; } }; const middle = { __proto__: top, tag1: 1 }; const heir = { __proto__: middle }; heir.tag1 = 2; return Object.keys(heir).join(); });
row("Object.create", () => { const top = { set tag2(v) { log.push("setter " + v); } }; const middle = Object.create(top); Object.defineProperty(middle, "tag2", { value: 1, writable: true, enumerable: true, configurable: true }); const heir = Object.create(middle); heir.tag2 = 2; return Object.keys(heir).join(); });
class Top3 { set tag3(v) { log.push("setter " + v); } get tag3() { return "top"; } }
class Middle3 extends Top3 { tag3 = 1; }
row("a class field", () => { const heir = Object.create(new Middle3()); heir.tag3 = 2; return Object.keys(heir).join(); });
row("a method nobody calls", () => { const top = { set tag4(v) { log.push("setter " + v); } }; const middle = { __proto__: top, tag4() {} }; const heir = { __proto__: middle }; heir.tag4 = 2; return Object.keys(heir).join(); });
row("Reflect.set", () => { const top = { set tag5(v) { log.push("setter " + v); } }; const middle = { __proto__: top, tag5: 1 }; const heir = { __proto__: middle }; return Reflect.set(heir, "tag5", 2) + " " + Object.keys(heir).join(); });
row("Object.assign", () => { const top = { set tag6(v) { log.push("setter " + v); } }; const middle = { __proto__: top, tag6: 1 }; const heir = { __proto__: middle }; Object.assign(heir, { tag6: 2 }); return Object.keys(heir).join(); });
const name7 = ["tag", "7"].join("");
row("a computed key", () => { const top = { set tag7(v) { log.push("setter " + v); } }; const middle = { __proto__: top, tag7: 1 }; const heir = { __proto__: middle }; heir[name7] = 2; return Object.keys(heir).join(); });
row("a read-only property above", () => { const top = Object.freeze({ tag8: 0 }); const middle = { __proto__: top, tag8: 1 }; const heir = { __proto__: middle }; heir.tag8 = 2; return Object.keys(heir).join(); });
row("a property made read-only above", () => { const top = {}; Object.defineProperty(top, "tag9", { value: 0 }); const middle = { __proto__: top, tag9: 1 }; const heir = { __proto__: middle }; heir.tag9 = 2; return Object.keys(heir).join(); });
function Top10() {}
Top10.prototype = { set tag10(v) { log.push("setter " + v); } };
function Base10() { this.tag10 = 2; }
Base10.prototype = { __proto__: Top10.prototype, tag10: 1 };
row("a store in a constructor function", () => Object.keys(new Base10()).join());
class Top11 { static set tag11(v) { log.push("setter " + v); } }
class Middle11 extends Top11 { static tag11 = 1; }
class Heir11 extends Middle11 {}
row("static fields", () => { Heir11.tag11 = 2; return Object.hasOwn(Heir11, "tag11"); });
row("two levels", () => { const top = { set tag12(v) { log.push("setter " + v); } }; const upper = { __proto__: top }; const middle = { __proto__: upper, tag12: 1 }; const lower = { __proto__: middle }; const heir = { __proto__: lower }; heir.tag12 = 2; return Object.keys(heir).join(); });
row("nothing above", () => { const middle = { tag13: 1 }; const heir = { __proto__: middle }; heir.tag13 = 2; return Object.keys(heir).join(); });
row("a name of Object.prototype", () => { const middle = { toString: 1, constructor: 2 }; const heir = { __proto__: middle }; heir.toString = 3; heir.constructor = 4; return Object.keys(heir).join(); });
row("the setter without the field", () => { const top = { set tag15(v) { log.push("setter " + v); } }; const middle = { __proto__: top }; const heir = { __proto__: middle }; heir.tag15 = 2; return Object.keys(heir).join(); });
row("the field is deleted first", () => { const top = { set tag16(v) { log.push("setter " + v); } }; const middle = { __proto__: top, tag16: 1 }; const heir = { __proto__: middle }; delete middle.tag16; heir.tag16 = 2; return Object.keys(heir).join(); });
row("a read through the heir", () => { const top = { get tag17() { log.push("getter"); return "top"; } }; const middle = { __proto__: top, tag17: 1 }; const heir = { __proto__: middle }; return heir.tag17; });
row("a test through the heir", () => { const middle = { tag18: 1 }; const heir = { __proto__: middle }; return ("tag18" in heir) + " " + Reflect.has(heir, "tag18") + " " + Object.hasOwn(heir, "tag18"); });
