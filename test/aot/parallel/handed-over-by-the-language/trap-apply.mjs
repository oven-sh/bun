const seen = [];
const handler = { apply(target, self, list) { seen.push("target:" + typeof target + (target === undefined ? "!" : "")); seen.push("self:" + typeof self + (self === undefined ? "!" : "")); seen.push("list:" + typeof list + (list === undefined ? "!" : "")); return Reflect.apply(target, self, list); } };
try { handler.apply(7, 7, 7); } catch {}
seen.push("|");
const p = new Proxy(function () {}, handler);
p(1);
console.log(seen.join(" "));
