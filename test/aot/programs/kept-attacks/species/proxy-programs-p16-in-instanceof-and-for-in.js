// Species: proxy programs  in instanceof and for in. It prints what plain Bun prints.
const log = [];
class Base { inherited() {} }
class Body extends Base { constructor() { super(); this.a = 1; } }
const p = new Proxy(new Body(), {});
log.push(String("a" in p), String("inherited" in p), String("none" in p), String(p instanceof Body), String(p instanceof Base), String(p instanceof Array));
for (const k in p) log.push(k);
log.push(String(Object.getPrototypeOf(p) === Body.prototype), String(p.constructor === Body), String(Reflect.has(p, "a")));
console.log(log.join("; "));
