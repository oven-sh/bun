// Bun.Cookie and Bun.CookieMap inherit from Object.prototype, and a bound function takes the prototype of its target. It still has its own `name` and `length`.
// No function that inherits from Function.prototype is bound here: its `name` would be found there.
const cookie = { name: Function.prototype.bind.call(Bun.Cookie, null).name };
console.log(cookie.name);
const cookieLength = { length: Function.prototype.bind.call(Bun.Cookie, null).length };
console.log(cookieLength.length);
const cookieMap = { name: Function.prototype.bind.call(Bun.CookieMap, null).name };
console.log(cookieMap.name);
const bound = Function.prototype.bind.call(Bun.Cookie, null);
const inherited = { bind: bound.bind, call: bound.call };
console.log(typeof inherited.bind, typeof inherited.call);
delete bound.name;
const deleted = { name: bound.name };
console.log(deleted.name);
Object.defineProperty(bound, "length", { value: "seven" });
const redefined = { length: bound.length };
console.log(redefined.length);
