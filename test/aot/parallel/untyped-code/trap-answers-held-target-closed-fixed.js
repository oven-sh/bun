// The traps ownKeys, getOwnPropertyDescriptor, defineProperty, has, set and deleteProperty may answer what they like for a target that is open and has configurable properties alone. A target that is closed, or has a property that cannot be configured, binds them. The target is looked at behind the call of the trap.
const told = work => { try { return work(); } catch (error) { return error.constructor.name + ": " + error.message.slice(0, 50); } };
const shown = value => JSON.stringify(value, (key, held) => held === undefined ? "undefined" : typeof held === "function" ? "function" : typeof held === "symbol" ? String(held) : held);
function say(label, value) { console.log(label + ": " + shown(value)); }
const targets = () => ({
  "open": { alpha: 1, beta: 2 }, "empty": {}, "closed": Object.preventExtensions({ alpha: 1, beta: 2 }), "sealed": Object.seal({ alpha: 1, beta: 2 }), "frozen": Object.freeze({ alpha: 1, beta: 2 }),
  "one fixed": Object.defineProperty({ alpha: 1, beta: 2 }, "alpha", { configurable: false }), "one fixed and read-only": Object.defineProperty({ beta: 2 }, "alpha", { value: 1, enumerable: true }),
  "a fixed getter": Object.defineProperty({ beta: 2 }, "alpha", { get() { return 1; }, enumerable: true }), "a getter": { get alpha() { return 1; }, beta: 2 }, "grown": Object.assign({ alpha: 1 }, { beta: 2, gamma: 3 }),
  "one deleted": (() => { const made = { alpha: 1, beta: 2 }; delete made.alpha; return made; })(), "an instance": new class { alpha = 1; beta = 2; }, "a list": [1, 2], "a frozen list": Object.freeze([1, 2]), "a function": function alpha() { },
});
const answers = {
  "ownKeys: none": { ownKeys() { return []; } }, "ownKeys: one": { ownKeys() { return ["alpha"]; } }, "ownKeys: another": { ownKeys() { return ["other"]; } }, "ownKeys: all and one more": { ownKeys(target) { return [...Reflect.ownKeys(target), "more"]; } },
  "ownKeys: twice": { ownKeys() { return ["alpha", "alpha"]; } }, "ownKeys: a number": { ownKeys() { return [1]; } }, "ownKeys: no list": { ownKeys() { return 5; } }, "ownKeys: honest": { ownKeys(target) { return Reflect.ownKeys(target); } },
  "descriptor: none": { getOwnPropertyDescriptor() { } }, "descriptor: honest": { getOwnPropertyDescriptor(target, key) { return Reflect.getOwnPropertyDescriptor(target, key); } },
  "descriptor: made up": { getOwnPropertyDescriptor() { return { value: 9, writable: true, enumerable: true, configurable: true }; } }, "descriptor: fixed": { getOwnPropertyDescriptor() { return { value: 1, writable: false, enumerable: true, configurable: false }; } },
  "descriptor: a number": { getOwnPropertyDescriptor() { return 5; } }, "descriptor: hidden": { getOwnPropertyDescriptor() { return { value: 1, enumerable: false, configurable: true }; } },
  "define: yes": { defineProperty() { return true; } }, "define: no": { defineProperty() { return false; } }, "define: honest": { defineProperty(target, key, descriptor) { return Reflect.defineProperty(target, key, descriptor); } },
  "has: no": { has() { return false; } }, "set: yes": { set() { return true; } }, "delete: yes": { deleteProperty() { return true; } }, "get: nine": { get() { return 9; } },
  "closes the target": { ownKeys(target) { Object.preventExtensions(target); return []; }, has(target) { Object.preventExtensions(target); return false; }, getOwnPropertyDescriptor(target) { Object.preventExtensions(target); }, deleteProperty(target) { Object.preventExtensions(target); return true; }, defineProperty(target) { Object.preventExtensions(target); return true; } },
};
const asks = {
  keys: proxy => Object.keys(proxy), ownKeys: proxy => Reflect.ownKeys(proxy).map(String), names: proxy => Object.getOwnPropertyNames(proxy), entries: proxy => Object.entries(proxy), spread: proxy => Object.keys({ ...proxy }), forIn: proxy => { const seen = []; for (const key in proxy) seen.push(key); return seen; }, json: proxy => JSON.stringify(proxy),
  hasOwn: proxy => [Object.hasOwn(proxy, "alpha"), Object.hasOwn(proxy, "other"), Object.prototype.hasOwnProperty.call(proxy, "beta"), Object.prototype.propertyIsEnumerable.call(proxy, "alpha")],
  descriptor: proxy => [Object.getOwnPropertyDescriptor(proxy, "alpha"), Reflect.getOwnPropertyDescriptor(proxy, "other")],
  define: proxy => [Reflect.defineProperty(proxy, "alpha", { value: 5 }), Reflect.defineProperty(proxy, "other", { value: 5, configurable: true }), Reflect.defineProperty(proxy, "fixed", { value: 5, configurable: false })],
  defineOrThrow: proxy => Object.keys(Object.defineProperty(proxy, "alpha", { value: 6 })),
  others: proxy => ["alpha" in proxy, "other" in proxy, Reflect.set(proxy, "alpha", 7), Reflect.deleteProperty(proxy, "alpha"), proxy.alpha],
  state: proxy => [Object.isExtensible(proxy), Object.isFrozen(proxy), Object.isSealed(proxy)],
};
for (let round = 0; round < 2; round++)
  for (const [nameOfAnswer, handler] of Object.entries(answers))
    for (const nameOfAsk of Object.keys(asks))
      say(nameOfAnswer + " | " + nameOfAsk, Object.keys(targets()).map(nameOfTarget => told(() => asks[nameOfAsk](new Proxy(targets()[nameOfTarget], handler)))));
const counted = { asks: 0 }, often = new Proxy({ alpha: 1, beta: 2 }, { ownKeys(target) { counted.asks++; return Reflect.ownKeys(target); }, getOwnPropertyDescriptor(target, key) { counted.asks++; return Reflect.getOwnPropertyDescriptor(target, key); }, defineProperty(target, key, descriptor) { counted.asks++; return Reflect.defineProperty(target, key, descriptor); } });
let sum = 0;
for (let i = 0; i < 20000; i++) { sum += Object.keys(often).length + Reflect.ownKeys(often).length + (Object.hasOwn(often, "alpha") ? 1 : 0) + (Object.hasOwn(often, "gamma") ? 1 : 0); often.beta = i; }
console.log(sum, counted.asks, often.beta);
