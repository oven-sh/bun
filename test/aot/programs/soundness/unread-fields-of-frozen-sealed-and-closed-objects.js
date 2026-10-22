// Nobody reads the fields. A store, a delete or a definition on a frozen, sealed or closed object, a store through an object that inherits from it, and the tests of integrity answer as in plain Bun.
"use strict";
function attempt(work) { try { return String(work()); } catch (error) { return error.name; } }
class A1 { constructor() { this.tag = 1; Object.freeze(this); } }
console.log("own store, frozen in the constructor", attempt(() => { const o = new A1(); o.tag = 2; return "stored"; }));
console.log("own store, frozen literal", attempt(() => { const o = Object.freeze({ tag2: 1 }); o.tag2 = 2; return "stored"; }));
console.log("own delete, frozen literal", attempt(() => { const o = Object.freeze({ tag3: 1 }); return delete o.tag3; }));
console.log("own delete, sealed literal", attempt(() => { const o = Object.seal({ tag4: 1 }); return delete o.tag4; }));
console.log("own store, sealed literal", attempt(() => { const o = Object.seal({ tag5: 1 }); o.tag5 = 2; return "stored"; }));
console.log("own store, not extensible", attempt(() => { const o = Object.preventExtensions({ tag6: 1 }); o.tag6 = 2; return "stored"; }));
console.log("own definition, frozen literal", attempt(() => { const o = Object.freeze({ tag7: 1 }); Object.defineProperty(o, "tag7", { value: 2 }); return "defined"; }));
console.log("same value defined, frozen literal", attempt(() => { const o = Object.freeze({ tag8: 1 }); Object.defineProperty(o, "tag8", { value: 1 }); return "defined"; }));
console.log("Reflect.set, frozen literal", attempt(() => Reflect.set(Object.freeze({ tag9: 1 }), "tag9", 2)));
console.log("heir of a frozen literal", attempt(() => { const heir = Object.create(Object.freeze({ tag10: 1 })); heir.tag10 = 2; return "stored " + Object.keys(heir).join(); }));
class B1 { constructor() { this.tag11 = 1; Object.freeze(this); } }
console.log("heir of a frozen instance", attempt(() => { const heir = Object.create(new B1()); heir.tag11 = 2; return "stored " + Object.keys(heir).join(); }));
console.log("heir by setPrototypeOf", attempt(() => { const heir = {}; Object.setPrototypeOf(heir, Object.freeze({ tag12: 1 })); heir.tag12 = 2; return "stored " + Object.keys(heir).join(); }));
console.log("heir by __proto__ in a literal", attempt(() => { const heir = { __proto__: Object.freeze({ tag13: 1 }) }; heir.tag13 = 2; return "stored " + Object.keys(heir).join(); }));
function Old() {}
Old.prototype = Object.freeze({ tag14: 1 });
console.log("heir by a constructor function", attempt(() => { const heir = new Old(); heir.tag14 = 2; return "stored " + Object.keys(heir).join(); }));
console.log("Object.assign to an heir", attempt(() => { const heir = Object.create(Object.freeze({ tag15: 1 })); Object.assign(heir, { tag15: 2 }); return "stored " + Object.keys(heir).join(); }));
console.log("definition on an heir", attempt(() => { const heir = Object.create(Object.freeze({ tag16: 1 })); Object.defineProperty(heir, "tag16", { value: 2, enumerable: true }); return "defined " + Object.keys(heir).join(); }));
console.log("isFrozen of a closed object", attempt(() => Object.isFrozen(Object.preventExtensions({ tag17: 1 })) + " " + Object.isSealed(Object.preventExtensions({ tag18: 1 }))));
class C1 { constructor() { this.tag19 = 1; } }
console.log("isFrozen of a closed instance", attempt(() => Object.isFrozen(Object.preventExtensions(new C1()))));
