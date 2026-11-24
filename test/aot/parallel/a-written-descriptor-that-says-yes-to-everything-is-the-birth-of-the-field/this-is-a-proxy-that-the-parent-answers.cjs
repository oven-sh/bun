"use strict";
let traps = 0, last = "";
class Base { constructor(isWatched) { if (isWatched) return new Proxy(this, { defineProperty(target, key, descriptor) { traps++; last = key + JSON.stringify(descriptor); return Reflect.defineProperty(target, key, descriptor); } }); } }
class Point extends Base { constructor(x, isWatched) { super(isWatched); Object.defineProperty(this, "x", { enumerable: true, configurable: true, writable: true, value: x }); } }
let made = 0; for (let turn = 0; turn < 3000; turn++) made += new Point(turn & 7, turn % 250 === 249).x;
console.log(made, traps, last);
