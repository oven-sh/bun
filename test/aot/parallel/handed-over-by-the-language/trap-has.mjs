const seen = [];
const handler = { has(target, key) { seen.push("target:" + typeof target + (target === undefined ? "!" : "")); seen.push("key:" + typeof key + (key === undefined ? "!" : "")); return Reflect.has(target, key); } };
try { handler.has(7, 7); } catch {}
seen.push("|");
const p = new Proxy(function () {}, handler);
"x" in p;
console.log(seen.join(" "));
