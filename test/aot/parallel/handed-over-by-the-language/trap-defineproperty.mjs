const seen = [];
const handler = { defineProperty(target, key, descriptor) { seen.push("target:" + typeof target + (target === undefined ? "!" : "")); seen.push("key:" + typeof key + (key === undefined ? "!" : "")); seen.push("descriptor:" + typeof descriptor + (descriptor === undefined ? "!" : "")); return Reflect.defineProperty(target, key, descriptor); } };
try { handler.defineProperty(7, 7, 7); } catch {}
seen.push("|");
const p = new Proxy(function () {}, handler);
Object.defineProperty(p, "x", { value: 1, configurable: true });
console.log(seen.join(" "));
