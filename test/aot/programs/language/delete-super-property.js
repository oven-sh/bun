// `delete super.x` throws a ReferenceError, once `this` is there and the key has been evaluated, and before the key is made a property key.
const log = [];
function tell(name, f) {
  try {
    console.log(name, f());
  } catch (error) {
    console.log(name, error.constructor.name, log.splice(0).join());
  }
}
const key = { toString() { log.push("the key is made a property key"); return "x"; } };
class Base { x() {} }
tell("by name", () => { class C extends Base { m() { return delete super.x; } } return new C().m(); });
tell("by key", () => { class C extends Base { m() { return delete super[(log.push("the key"), key)]; } } return new C().m(); });
tell("in an object", () => ({ m() { return delete super.x; } }).m());
tell("a static method", () => { class C extends Base { static m() { return delete super.x; } } return C.m(); });
tell("without a prototype", () => { const o = { m() { return delete super.x; } }; Object.setPrototypeOf(o, null); return o.m(); });
tell("a key that throws", () => { class C extends Base { m() { return delete super[(() => { throw new RangeError(); })()]; } } return new C().m(); });
tell("ahead of super()", () => { class C extends Base { constructor() { delete super.x; super(); } } return new C(); });
tell("in an arrow function", () => { class C extends Base { m() { return (() => delete super.x)(); } } return new C().m(); });
tell("the method is still there", () => typeof new Base().x);
