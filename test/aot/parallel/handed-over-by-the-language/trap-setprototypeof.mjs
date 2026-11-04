const seen = [];
const handler = { setPrototypeOf(target, proto) { seen.push("target:" + typeof target + (target === undefined ? "!" : "")); seen.push("proto:" + typeof proto + (proto === undefined ? "!" : "")); return Reflect.setPrototypeOf(target, proto); } };
try { handler.setPrototypeOf(7, 7); } catch {}
seen.push("|");
const p = new Proxy(function () {}, handler);
Object.setPrototypeOf(p, null);
console.log(seen.join(" "));
