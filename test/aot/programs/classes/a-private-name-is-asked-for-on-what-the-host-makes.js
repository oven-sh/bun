// `#name in value` for arrays, functions, collections, proxies, boxed values and what is no object, in a class below nothing, a class below a class and a class below a function that hands back what it is given.
const lines = [];
class Alone { #mark = 1; static has(value) { return #mark in value; } static hasArray(list) { return #mark in list; } static hasFunction(f) { return #mark in f; } }
class Below extends Alone { #low = 2; static low(value) { return #low in value; } }
function Identity(object) { return object; }
class Stamper extends Identity { #stamp = 3; static has(value) { return #stamp in value; } static hasArray(list) { return #stamp in list; } }
const list = [1, 2], table = new Map(), callable = function () {}, arrow = () => 1, proxy = new Proxy(new Alone(), {}), bound = callable.bind(null);
const hosts = [list, table, callable, arrow, proxy, bound, new Set(), new Date(0), /x/, new Error("e"), Promise.resolve(1), new Uint8Array(2), Object(1), Object("s"), Symbol.prototype, Alone, Below, globalThis, Math, JSON];
lines.push(hosts.map((value) => (Alone.has(value) ? 1 : 0)).join(""), hosts.map((value) => (Below.low(value) ? 1 : 0)).join(""), hosts.map((value) => (Stamper.has(value) ? 1 : 0)).join(""));
for (const value of [list, table, callable, proxy]) new Stamper(value);
lines.push(hosts.map((value) => (Stamper.has(value) ? 1 : 0)).join(""), hosts.map((value) => (Alone.has(value) ? 1 : 0)).join(""));
lines.push(Alone.hasArray(list), Alone.hasArray([]), Stamper.hasArray(list), Stamper.hasArray([]), Alone.hasFunction(callable), Alone.hasFunction(Alone));
lines.push(Alone.has(new Alone()), Alone.has(new Below()), Below.low(new Alone()), Below.low(new Below()), Alone.has(Reflect.construct(Alone, [], Array)), Array.isArray(Reflect.construct(Alone, [], Array)), Alone.has(Object.create(new Alone())));
for (const bad of [undefined, null, 1, "text", true, 1n, Symbol()]) for (const K of [Alone, Stamper]) { try { lines.push(K.has(bad)); } catch (error) { lines.push(error.constructor.name + ":" + error.message); } }
const mixed = [new Alone(), {}, new Below(), [], undefined];
let count = 0, thrown = 0;
for (let i = 0; i < 500; i++) { try { count += Alone.has(mixed[i % 5]) ? 1 : 0; } catch { thrown++; } }
lines.push(count, thrown);
console.log(lines.join("\n"));
