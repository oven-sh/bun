let calls = 0, reads = 0;
function tick() { calls++; }
const descriptor = { get() { reads++; return 1; } };
function sliced(from) { const list = from.slice(); Object.defineProperty(list, 0, descriptor); tick.apply(null, list); }
function mapped(from) { const list = from.map((x) => x); Object.defineProperty(list, 0, descriptor); tick.apply(null, list); }
function made() { const list = new Array(3); Object.defineProperty(list, 0, descriptor); tick.apply(null, list); }
function from(source) { const list = Array.from(source); Object.defineProperty(list, 0, descriptor); tick.apply(null, list); }
function keys(object) { const list = Object.keys(object); Object.defineProperty(list, 0, descriptor); tick.apply(null, list); }
for (let i = 0; i < 300; i++) sliced([1, 2]);
console.log(calls, reads);
for (let i = 0; i < 300; i++) mapped([1, 2]);
console.log(calls, reads);
for (let i = 0; i < 300; i++) made();
console.log(calls, reads);
for (let i = 0; i < 300; i++) from([1, 2]);
console.log(calls, reads);
for (let i = 0; i < 300; i++) keys({ a: 1, b: 2 });
console.log(calls, reads);
