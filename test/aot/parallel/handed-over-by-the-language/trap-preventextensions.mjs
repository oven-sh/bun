const seen = [];
const handler = { preventExtensions(target, more) { seen.push("target:" + typeof target + (target === undefined ? "!" : "")); seen.push("more:" + typeof more + (more === undefined ? "!" : "")); return Reflect.preventExtensions(target); } };
try { handler.preventExtensions(7, 7); } catch {}
seen.push("|");
const p = new Proxy(function () {}, handler);
Object.preventExtensions(p);
console.log(seen.join(" "));
