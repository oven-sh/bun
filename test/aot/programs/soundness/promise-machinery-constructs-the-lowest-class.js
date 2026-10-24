const log = [];
class A extends Promise {
  constructor(executor) { super(executor); this.kind = this.describe(); log.push(new.target.name); }
  describe() { return "A"; }
}
class B extends A {
  extra = "x";
  describe() { return "B " + this.extra; }
}
function show(label, o) { console.log(label, o.constructor.name, o.kind, o.extra, o instanceof B, Object.keys(o).join()); }
const p = B.resolve(1);
show("resolve", p);
const q = p.then(v => v + 1);
show("then", q);
show("catch", q.catch(() => 0));
show("finally", q.finally(() => {}));
show("all", B.all([p, q]));
show("race", B.race([p]));
show("allSettled", B.allSettled([p]));
show("any", B.any([p]));
const rejected = B.reject(new Error("no")); rejected.catch(() => {});
show("reject", rejected);
const w = B.withResolvers(); w.resolve(5);
show("withResolvers", w.promise);
show("call", Promise.resolve.call(B, 2));
show("base", A.resolve(3));
async function f() { return await q + await w.promise; }
f().then(v => { console.log("awaited", v, log.join()); });
