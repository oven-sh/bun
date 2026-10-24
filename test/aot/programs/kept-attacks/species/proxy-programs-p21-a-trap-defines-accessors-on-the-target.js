// Species: proxy programs  a trap defines accessors on the target. It prints what plain Bun prints.
const log = [];
class Body { constructor() { this.hits = 1; this.name = "b"; } twice() { return this.hits * 2; } label() { return this.name + "!"; } }
const b = new Body(); log.push(String(b.twice()), b.label());
const p = new Proxy(b, {
  set(target, key, value) {
    Object.defineProperty(target, key, { get() { log.push("getter " + String(key) + " " + (this === target)); return value; }, set(next) { log.push("setter " + typeof next); }, configurable: true });
    return true;
  },
  defineProperty(target, key, descriptor) { log.push("define " + String(key)); return Reflect.defineProperty(target, key, descriptor); },
});
p.hits = 21; p.name = 5;
log.push(String(b.twice()), b.label()); b.hits = "x";
Object.defineProperty(p, "extra", { get() { return "e"; }, configurable: true });
log.push(String(b.extra), String(new Body().twice()), new Body().label());
console.log(log.join("; "));
