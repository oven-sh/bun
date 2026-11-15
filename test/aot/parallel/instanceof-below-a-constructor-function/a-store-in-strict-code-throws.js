"use strict";
function Base(v) { this.held = v; }
class A extends Base { constructor(v) { super(v); this.y = 2; } }
let thrown = "nothing";
try {
    Base[Symbol.hasInstance] = function () { return true; };
} catch (error) {
    thrown = error.constructor.name;
}
console.log(thrown, new Base(1) instanceof A, Object.hasOwn(Base, Symbol.hasInstance));
