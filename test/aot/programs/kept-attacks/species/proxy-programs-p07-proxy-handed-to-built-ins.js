// Species: proxy programs  proxy handed to built ins. It prints what plain Bun prints.
const log = [];
class Body { constructor() { this.a = 1; this.b = "x"; } toJSON() { log.push("toJSON " + (this instanceof Body)); return { a: this.a }; } get c() { log.push("getter c"); return 3; } }
const b = new Body();
const p = new Proxy(b, {});
log.push(JSON.stringify(p), Object.keys(p).join(), Object.values(p).join(), JSON.stringify({ ...p }), JSON.stringify(Object.assign({}, p)), String(Array.isArray(new Proxy([1], {}))), String(Reflect.get(p, "c")));
for (const key in p) log.push("in " + key);
const list = new Proxy([1, 2, 3], {});
log.push(String(list.length), list.map(x => x * 2).join(), [...list].join(), String(Math.max(...list)));
console.log(log.join("; "));
