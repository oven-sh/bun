// Species: proxy programs  array target. It prints what plain Bun prints.
const log = [];
const inner = [1, 2, 3]; const p = new Proxy(inner, {});
p.push("s"); p[0] = null; p.length = 3;
log.push(JSON.stringify(inner), String(inner.length), String(Array.isArray(p)), typeof inner[0]);
let sum = 0; for (let i = 0; i < inner.length; i++) sum += inner[i] === null ? 100 : inner[i];
log.push(String(sum));
console.log(log.join("; "));
