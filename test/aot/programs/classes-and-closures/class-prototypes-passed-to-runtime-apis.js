// The `prototype` object of a class is an ordinary object to the runtime: it can be cloned, sent, and compared.
import { serialize, deserialize } from "bun:jsc";

function tell(name, f) {
  try {
    console.log(name + ": " + JSON.stringify(f()));
  } catch (e) {
    console.log(name + ": " + e.name + ": " + e.message);
  }
}

class A { method() {} }
class B extends A { get x() { return 1; } }
class C extends Response {}
class D { method() {} }
class E { method() {} }
class F { method() {} }
class G { method() {} }
class H { method() {} }
class I { method() {} }
class J { method() {} }
class K { method() {} }
class L { method() {} }
function Old() {}
Old.prototype.method = function () {};

tell("structuredClone", () => structuredClone(A.prototype));
tell("structuredClone, derived", () => structuredClone(B.prototype));
tell("structuredClone, derived from a class of the runtime", () => structuredClone(C.prototype));
tell("structuredClone, inside an object", () => structuredClone({ inner: D.prototype }));
tell("structuredClone, by getPrototypeOf", () => structuredClone(Object.getPrototypeOf(new E())));
tell("structuredClone, of a function", () => structuredClone(function () {}.prototype));
tell("structuredClone, with a function in it", () => structuredClone(Old.prototype));
tell("structuredClone, the class itself", () => structuredClone(A));
tell("structuredClone, an instance", () => structuredClone(new A()));
tell("serialize", () => deserialize(serialize(F.prototype)));
tell("postMessage", () => {
  const channel = new MessageChannel();
  channel.port1.postMessage(G.prototype);
  channel.port1.close();
  return "sent";
});
tell("deepEquals", () => Bun.deepEquals(H.prototype, {}));
tell("deepEquals, strict", () => Bun.deepEquals(I.prototype, {}, true));
tell("deepEquals, strict, the other way round", () => Bun.deepEquals({}, J.prototype, true));
tell("deepEquals, strict, two prototypes", () => Bun.deepEquals(K.prototype, L.prototype, true));
