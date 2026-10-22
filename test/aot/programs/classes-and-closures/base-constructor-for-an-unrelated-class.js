class A { constructor() { this.x = 1; } m() { return "A.m"; } }
class U { m() { return "U.m"; } }
function read(o) { return o.extra + " " + o.x + " " + o.m() + " " + (o instanceof A) + " " + (o instanceof U); }
const a = new A();
const o = Reflect.construct(A, [], U);
o.extra = 7;
console.log(read(a)); console.log(read(o)); console.log(Object.keys(o).join());
delete o.x;
console.log(read(a)); console.log(read(o)); console.log(Object.keys(o).join());
const p = Reflect.construct(A, [], U);
Object.freeze(p);
function store(t) { "use strict"; try { t.x = 5; return t.x; } catch (e) { return e.name; } }
console.log(store(a), store(p));
