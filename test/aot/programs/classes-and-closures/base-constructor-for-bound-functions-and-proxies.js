class A { x = 1; constructor() { this.y = 2; this.seen = typeof this.m === "function" ? this.m() : "none"; } m() { return "A.m"; } }
class U { m() { return "U.m"; } }
class S extends A { m() { return "S.m"; } }
function read(o) { return o.extra + " " + o.x + " " + o.y + " " + o.seen + " " + (typeof o.m === "function" ? o.m() : "none") + " " + (o instanceof A) + " " + Object.keys(o).join(); }
const list = [new A(), Reflect.construct(A, [], A.bind(null)), Reflect.construct(A, [], S.bind(null)), Reflect.construct(A, [], new Proxy(U, {})), Reflect.construct(A, [], new Proxy(S, {})), Reflect.construct(A, [], new Proxy(A, {})), new (new Proxy(A, {}))(), new (new Proxy(S, {}))(), Reflect.construct(A, [], Object), Reflect.construct(A, [], Array), Reflect.construct(A, [], function () {})];
for (let i = 1; i < list.length; i++) list[i].extra = i;
for (let i = 0; i < list.length; i++) { try { console.log(read(list[i])); } catch (e) { console.log(i + " threw " + e.name); } }
for (let i = 1; i < list.length; i++) delete list[i].x;
for (let i = 0; i < list.length; i++) { try { console.log(read(list[i])); } catch (e) { console.log(i + " threw " + e.name); } }
