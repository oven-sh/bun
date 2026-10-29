// A polyfill written as `X.y = X.y || f` stores the value that the member holds. That changes nothing, so a compiled program accepts it for a locked member, in strict code too, as it accepts a definition that changes nothing. spdy says `Object.assign = .. ? Object.assign : util._extend`, and what old releases of Emscripten write says `Math.imul = Math["imul"]`. The output is that of plain Bun.
function attempt(run) { try { return String(run()); } catch (e) { return e.name; } }
function polyfill() { return "polyfill"; }

console.log(attempt(() => { Number.isInteger = Number.isInteger || polyfill; return Number.isInteger(5); }));
console.log(attempt(() => { Object.assign = Object.assign || polyfill; return Object.assign({}, { a: 1 }).a; }));
console.log(attempt(() => { Array.isArray = Array.isArray || polyfill; return Array.isArray([]); }));
console.log(attempt(() => { Math.imul = Math["imul"]; Math.fround = Math["fround"]; Math.clz32 = Math["clz32"]; Math.trunc = Math["trunc"]; return Math.imul(3, 4); }));
console.log(attempt(() => { Array.prototype.includes = Array.prototype.includes || polyfill; return [1].includes(1); }));
console.log(attempt(() => { String.prototype.trim = String.prototype.trim || polyfill; return " a ".trim(); }));
console.log(attempt(() => { Promise.prototype.finally = Promise.prototype.finally || polyfill; return typeof Promise.prototype.finally; }));
console.log(attempt(() => { Object.prototype.hasOwnProperty = Object.prototype.hasOwnProperty; return ({ a: 1 }).hasOwnProperty("a"); }));
console.log(attempt(() => { globalThis.Symbol = globalThis.Symbol || polyfill; globalThis.Math = Math; Object = Object; return typeof Symbol.iterator; }));
console.log(attempt(() => Reflect.set(Math, "max", Math.max)));
console.log(attempt(() => Reflect.set(Array.prototype, "push", Array.prototype.push)));
console.log(attempt(() => { Object.defineProperty(Math, "max", { value: Math.max }); return Math.max(1, 2); }));
console.log(attempt(() => { Number.parseFloat = parseFloat; return Number.parseFloat("1.5"); }));
console.log(attempt(() => { Math.PI = Math.PI; return "stored"; }));
console.log(attempt(() => { Number.MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER; return "stored"; }));
export {};
