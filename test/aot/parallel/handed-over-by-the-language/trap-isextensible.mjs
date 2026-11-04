const seen = [];
const handler = { isExtensible(target, more) { seen.push("target:" + typeof target + (target === undefined ? "!" : "")); seen.push("more:" + typeof more + (more === undefined ? "!" : "")); return Reflect.isExtensible(target); } };
try { handler.isExtensible(7, 7); } catch {}
seen.push("|");
const p = new Proxy(function () {}, handler);
Object.isExtensible(p);
console.log(seen.join(" "));
