// `value instanceof bound` asks the target of the bound function in its place: for its method under Symbol.hasInstance, and else for its prototype property. Nothing else in the program leads to what runs then.
function ask(value, ctor) { return value instanceof ctor; }
let calls = 0;
const D = () => {};
Object.defineProperty(D, Symbol.hasInstance, { value(value) { calls++; return value === 1; } });
const boundD = D.bind();
try { console.log("bound", ask(1, boundD), ask(2, boundD), calls); } catch (e) { console.log("bound threw", String(e).slice(0, 70)); }
const arrow = () => {};
const proxy = new Proxy(arrow, { get(target, key, receiver) { return Reflect.get(target, key, receiver); } });
const boundProxy = proxy.bind();
try { console.log("proxy", ask(1, boundProxy)); } catch (e) { console.log("proxy threw", String(e).slice(0, 70)); }
