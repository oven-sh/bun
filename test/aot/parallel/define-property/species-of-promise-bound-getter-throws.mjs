// Promise.prototype.then reads Symbol.species of the constructor. The getter is a bound function that throws, then the same function unbound: the promise is rejected both times.
function withConstructor(constructor) { const promise = Promise.resolve(1); promise.constructor = constructor; return promise; }
const o = {};
Object.defineProperty(o, Symbol.species, { get: function () { nowhere; }.bind(), configurable: true });
async function run(x) { let kind; try { kind = await withConstructor(x).then(); } catch (e) { kind = e.name; } return kind; }
console.log(await run(o));
const p = {};
Object.defineProperty(p, Symbol.species, { get: function () { nowhere; }, configurable: true });
console.log(await run(p));
