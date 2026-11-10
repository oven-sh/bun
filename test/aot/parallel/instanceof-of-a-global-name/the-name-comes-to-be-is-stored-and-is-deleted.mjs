function isOne(x) { try { return x instanceof Crate; } catch (error) { return error.constructor.name + ": " + error.message; } }
globalThis.kept = isOne;
function tell(when, ...all) { let last; for (let i = 0; i < 3; i++) last = all.map(x => globalThis.kept(x)).join(" . "); console.log(when, "|", last); }
tell("not there", {}, 7);
globalThis.Crate = function () {};
const First = globalThis.Crate, one = new First();
tell("a function", one, {}, 7, null);
globalThis.Crate = class {};
tell("a class", one, new globalThis.Crate(), undefined);
delete globalThis.Crate;
tell("deleted", one);
globalThis.Crate = 5;
tell("a number", one, 7);
globalThis.Crate = {};
tell("an object that cannot be called", one, 7);
globalThis.Crate = { [Symbol.hasInstance]: x => x === 7 };
tell("an object with a method of its own", 7, one);
globalThis.Crate = First.bind(null);
tell("a bound function", one, {});
globalThis.Crate = new Proxy(First, { get(target, key, receiver) { if (key === "prototype") console.log("asked for prototype"); return Reflect.get(target, key, receiver); } });
tell("a proxy", one);
globalThis.Crate = First;
First.prototype = {};
tell("another prototype object", one, new First());
