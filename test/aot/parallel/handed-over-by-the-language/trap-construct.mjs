const seen = [];
const handler = { construct(target, list, newTarget) { seen.push("target:" + typeof target + (target === undefined ? "!" : "")); seen.push("list:" + typeof list + (list === undefined ? "!" : "")); seen.push("newTarget:" + typeof newTarget + (newTarget === undefined ? "!" : "")); return Reflect.construct(target, list, newTarget); } };
try { handler.construct(7, 7, 7); } catch {}
seen.push("|");
const p = new Proxy(function () {}, handler);
new p(1);
console.log(seen.join(" "));
