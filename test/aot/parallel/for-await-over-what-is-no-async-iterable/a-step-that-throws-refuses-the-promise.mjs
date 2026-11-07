const broken = { [Symbol.iterator]() { return this; }, next() { throw new TypeError("no more"); } };
async function* relay() { yield* broken; }
const step = relay().next();
console.log(step instanceof Promise, Object.getPrototypeOf(step) === Promise.prototype);
try { await step; } catch (error) { console.log(error.name, error.message); }
const odd = { [Symbol.iterator]() { return this; }, next() { return 7; } };
try { for await (const item of odd) console.log(item); } catch (error) { console.log(error.name); }
