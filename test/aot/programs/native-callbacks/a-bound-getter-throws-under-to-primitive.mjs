// A bound function makes its name when it is first asked for. Nobody asks for it while what the function has thrown is on its way: the throw of a getter arrives at whoever read the property.
let calls = 0;
const thrower = function () { calls++; throw new RangeError("getter ran"); }.bind();
function tryIt(name, run) { try { console.log(name, run(), calls); } catch (e) { console.log(name, e.name, calls); } }
const c = {}; Object.defineProperty(c, Symbol.toPrimitive, { get: thrower });
tryIt("toPrimitive", () => `${c}`);
const l = Promise.resolve(1); Object.defineProperty(l, "constructor", { get: thrower });
tryIt("promise constructor getter, then", () => typeof l.then());
