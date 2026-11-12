class P { constructor(x) { this.x = x; } }
const out = [Reflect.construct(P, [1]).x]; try { Reflect.apply(P, null, [1]); } catch (e) { out.push(e.name + ": " + e.message); } try { P.call(null, 1); } catch (e) { out.push(e.name); }
console.log(out.join(" | "));
