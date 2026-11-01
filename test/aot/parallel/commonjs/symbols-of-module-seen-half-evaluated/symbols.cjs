"use strict";
// holder.cjs runs here, in front of the store below, and sees the object that this module began with.
const holder = require("./holder.cjs");
const atStart = holder.make(3, 4);
console.log(Reflect.ownKeys(atStart).map(String).join(","), holder.read(atStart));
module.exports = { kFirst: Symbol("first"), kSecond: Symbol("second") };
holder.look();
const behind = holder.make(5, 6);
console.log(Reflect.ownKeys(behind).map(String).join(","), holder.read(behind));
