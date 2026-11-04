const seen = [];
const handler = { getPrototypeOf(target, more) { seen.push("target:" + typeof target + (target === undefined ? "!" : "")); seen.push("more:" + typeof more + (more === undefined ? "!" : "")); return Reflect.getPrototypeOf(target); } };
try { handler.getPrototypeOf(7, 7); } catch {}
seen.push("|");
const p = new Proxy(function () {}, handler);
Object.getPrototypeOf(p);
console.log(seen.join(" "));
