const seen = [];
const handler = { get(target, key, receiver) { seen.push("target:" + typeof target + (target === undefined ? "!" : "")); seen.push("key:" + typeof key + (key === undefined ? "!" : "")); seen.push("receiver:" + typeof receiver + (receiver === undefined ? "!" : "")); return Reflect.get(target, key, receiver); } };
try { handler.get(7, 7, 7); } catch {}
seen.push("|");
const p = new Proxy(function () {}, handler);
p.x;
console.log(seen.join(" "));
