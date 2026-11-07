"use strict";
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
globalThis.runsOfTheBundle = (globalThis.runsOfTheBundle || 0) + 1;
var Base;
var initBase = __esm(() => { Base = class Base { constructor(x) { this.x = x; } }; });
var requirePoint = __commonJS((exports, module) => {
    initBase();
    let count = 0;
    const run = globalThis.runsOfTheBundle;
    class Point extends Base {
        #mark = run;
        static made = 0;
        constructor(x) { super(x); count++; Point.made++; }
        sum() { return this.x + this.#mark * 100; }
        static has(object) { return #mark in object; }
    }
    module.exports = { Point, make: x => new Point(x), count: () => count, runs: () => run };
});
module.exports = requirePoint();
