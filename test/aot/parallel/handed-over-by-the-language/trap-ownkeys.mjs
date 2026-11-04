const seen = [];
const handler = { ownKeys(target, more) { seen.push("target:" + typeof target + (target === undefined ? "!" : "")); seen.push("more:" + typeof more + (more === undefined ? "!" : "")); return Reflect.ownKeys(target); } };
try { handler.ownKeys(7, 7); } catch {}
seen.push("|");
const p = new Proxy(function () {}, handler);
Reflect.ownKeys(p);
console.log(seen.join(" "));
