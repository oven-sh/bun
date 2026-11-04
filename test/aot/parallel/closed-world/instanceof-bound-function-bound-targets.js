// `value instanceof bound` asks the target of the bound function in its place: for its method under Symbol.hasInstance, and else for its prototype property. Nothing else in the program leads to what runs then.
function ask(value, ctor) { return value instanceof ctor; }
let calls = 0;
class Base {}
const T = () => {};
Object.defineProperty(T, "prototype", { get() { calls++; return Base.prototype; } });
const bound = T.bind();
try { console.log("getter of prototype", ask(new Base(), bound), ask({}, bound), calls); } catch (e) { console.log("threw", String(e).slice(0, 70)); }
const proxy = new Proxy(() => {}, { get(target, key, receiver) { return Reflect.get(target, key, receiver); } });
try { console.log("proxy", ask(1, proxy.bind())); } catch (e) { console.log("proxy threw", String(e).slice(0, 70)); }
