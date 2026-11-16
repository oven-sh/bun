// Made by test/aot/tools/generate-calls-through-the-method-table-while-classes-are-defined.py.
const unseen = (0, eval);
function Base() {}
class L extends Base { a() { return 1; } 0() { return 0; } c() { return 3; } }
class M extends L { a() { return 10; } }
function measure(o) { return o.a() + o.c(); }
const l = new L(), m = new M();
console.log(measure(l), measure(m));
Base.prototype.c = () => 5; delete L.prototype.c;
console.log(measure(l), measure(m), measure(new L()), measure(new M()));
