// Species: proxy programs  handler gets its trap later. It prints what plain Bun prints.
const log = [];
class Body { constructor() { this.hits = 1; } }
const b = new Body(); const handler = {};
const p = new Proxy(b, handler);
log.push(String(p.hits));
handler.get = function (target, key) { log.push("trap " + String(key) + " " + (target === b)); return 7; };
log.push(String(p.hits));
const inherited = Object.create({ has(target, key) { log.push("has " + String(key)); return true; } });
log.push(String("nothing" in new Proxy(b, inherited)));
console.log(log.join("; "));
