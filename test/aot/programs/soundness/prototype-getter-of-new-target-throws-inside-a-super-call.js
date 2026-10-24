const T = function () {}.bind(null);
Object.defineProperty(T, "prototype", { get() { throw new RangeError("from getter"); } });
class A extends Map { constructor() { try { super(); } catch (e) { console.log("caught in A", e.name); throw e; } } }
try { Reflect.construct(A, [], T); } catch (e) { console.log("caught", e.name); }
console.log(new A().size);
