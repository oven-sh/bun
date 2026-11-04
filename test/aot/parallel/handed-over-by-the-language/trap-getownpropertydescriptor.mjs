const seen = [];
const handler = { getOwnPropertyDescriptor(target, key) { seen.push("target:" + typeof target + (target === undefined ? "!" : "")); seen.push("key:" + typeof key + (key === undefined ? "!" : "")); return Reflect.getOwnPropertyDescriptor(target, key); } };
try { handler.getOwnPropertyDescriptor(7, 7); } catch {}
seen.push("|");
const p = new Proxy(function () {}, handler);
Object.getOwnPropertyDescriptor(p, "x");
console.log(seen.join(" "));
