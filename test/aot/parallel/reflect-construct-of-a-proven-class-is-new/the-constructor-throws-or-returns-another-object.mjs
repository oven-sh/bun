class T { constructor(x) { if (x > 1) throw new RangeError("too big " + x); this.x = x; } }
class O { constructor(x) { return { other: x }; } }
class D extends T { constructor(x) { super(x); return x ? undefined : { none: 1 }; } }
const out = [Reflect.construct(T, [1]).x]; try { Reflect.construct(T, [2]); } catch (e) { out.push(e.message); }
out.push(Reflect.construct(O, [5]).other, JSON.stringify(Reflect.construct(D, [0])), JSON.stringify(Reflect.construct(D, [1])));
console.log(out.join(" | "));
