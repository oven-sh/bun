const shared = { n: 0 };
Object.defineProperties(Event.prototype, Object.getOwnPropertyDescriptors({ counter: shared }));
new CustomEvent("x").counter.n = 7;
console.log(`${shared.n}`);
