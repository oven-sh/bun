class A { who() { return "a"; } }
const P = new Proxy(A, { get(t, k, r) { console.log("trap", String(k)); return Reflect.get(t, k, r); } });
class B extends P {}
export const read = () => B;
