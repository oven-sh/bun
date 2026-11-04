const seen = [];
const handler = { set(target, key, value, receiver) { seen.push("target:" + typeof target + (target === undefined ? "!" : "")); seen.push("key:" + typeof key + (key === undefined ? "!" : "")); seen.push("value:" + typeof value + (value === undefined ? "!" : "")); seen.push("receiver:" + typeof receiver + (receiver === undefined ? "!" : "")); return Reflect.set(target, key, value, receiver); } };
try { handler.set(7, 7, 7, 7); } catch {}
seen.push("|");
const p = new Proxy(function () {}, handler);
p.x = "v";
console.log(seen.join(" "));
