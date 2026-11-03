// A proxy of a function is bound, called through the bound function, and values are tested against it. The handler hands every read on and has no other trap, so all of it goes on at the target, and nothing of the library is in the executable.
// STATISTIC: ImageFunctionsEmitted <= 30
function ask(value, constructor) { return value instanceof constructor; }
let asked = 0;
const judge = () => {};
Object.defineProperty(judge, Symbol.hasInstance, { value(value) { asked++; return value === 1; } });
const boundJudge = judge.bind();
try { console.log("bound", ask(1, boundJudge), ask(2, boundJudge), asked); } catch (e) { console.log("bound threw", String(e).slice(0, 70)); }
function add(a, b) { return this.base + a + b; }
const reads = [];
const proxy = new Proxy(add, { get(target, key, receiver) { reads.push(String(key)); return Reflect.get(target, key, receiver); } });
const boundProxy = proxy.bind({ base: 100 }, 1);
try { console.log("proxy", ask(1, boundProxy), ask({}, boundProxy), ask(Object.create(add.prototype), boundProxy)); } catch (e) { console.log("proxy threw", String(e).slice(0, 70)); }
console.log(boundProxy(2), boundProxy.name, boundProxy.length, proxy.call({ base: 10 }, 1, 2));
console.log(reads.join());
