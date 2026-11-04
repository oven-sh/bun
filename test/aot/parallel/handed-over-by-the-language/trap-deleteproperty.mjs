const seen = [];
const handler = { deleteProperty(target, key) { seen.push("target:" + typeof target + (target === undefined ? "!" : "")); seen.push("key:" + typeof key + (key === undefined ? "!" : "")); return Reflect.deleteProperty(target, key); } };
try { handler.deleteProperty(7, 7); } catch {}
seen.push("|");
const p = new Proxy(function () {}, handler);
delete p.x;
console.log(seen.join(" "));
