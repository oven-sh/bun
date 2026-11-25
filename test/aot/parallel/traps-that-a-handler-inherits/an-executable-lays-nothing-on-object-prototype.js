// The program tries to lay both traps on Object.prototype. An executable refuses, so the handler inherits neither and the stores end in the target.
function fill(proxy, count) { for (let i = 0; i < count; i++) proxy.width = i; }
function attempt(write) { try { write(); return "laid"; } catch (error) { return error.constructor.name; } }
let calls = 0;
const target = { width: 1 }, proxy = new Proxy(target, { label: "plain" });
fill(proxy, 300);
console.log(attempt(() => { Object.prototype.defineProperty = function (target, key, descriptor) { calls++; return Reflect.defineProperty(target, key, descriptor); }; }));
console.log(attempt(() => { Object.defineProperty(Object.prototype, "getOwnPropertyDescriptor", { configurable: true, value(target, key) { calls++; return Reflect.getOwnPropertyDescriptor(target, key); } }); }));
console.log("defineProperty" in {}, "getOwnPropertyDescriptor" in {});
fill(proxy, 300);
console.log(calls, target.width);
/* Output:
TypeError
TypeError
false false
0 299
*/
