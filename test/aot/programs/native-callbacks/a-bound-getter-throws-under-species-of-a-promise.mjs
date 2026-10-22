// As its neighbor under Symbol.toPrimitive: the getter under Symbol.species of what stands as a promise's constructor is a bound function, and it throws.
function withConstructor(constructor) { const promise = Promise.resolve(1); promise.constructor = constructor; return promise; }
const o = {};
Object.defineProperty(o, Symbol.species, { get: function () { nowhere; }.bind(), configurable: true });
async function run(x) { let kind; try { kind = await withConstructor(x).then(); } catch (e) { kind = e.name; } return kind; }
console.log(await run(o));
const p = {};
Object.defineProperty(p, Symbol.species, { get: function () { nowhere; }, configurable: true });
console.log(await run(p));
