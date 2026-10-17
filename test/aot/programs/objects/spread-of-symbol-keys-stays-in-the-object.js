// A literal that spreads an object with symbol keys and adds members has room for all of them in the object itself, so what inherits from it reads them without another load.
import { jscDescribe } from "bun:jsc";
const tag = Symbol("tag");
const base = { kind: "base", [tag]: 1, pipe() {}, [Symbol.iterator]() {}, toJSON() {}, toString() {}, asEffect() {} };
const extend = options => ({ ...base, identifier: options.op, evaluate: options.evaluate, onSuccess: options.onSuccess, onFailure: options.onFailure, onBoth: options.onBoth });
for (let i = 0; i < 3; i++) console.log("the copy has storage out of line:", !jscDescribe(extend({ op: i })).includes("butterfly (nil)"));
