// The prototype that a built-in constructor takes from an odd new.target (its `prototype` is a number or null, a bound function, a proxy, one that moves), what cannot be new.target, Proxy, and a class whose parent is decided or changed at run time.
function show(label, ...values) { console.log(label, ...values); }
function attempt(label, run) {
  try { run(); } catch (error) { console.log(label, "throws", error.constructor.name); }
}
// new.target.prototype is no object: the prototype object of the constructor's own class is taken.
function WithNumber() {}
WithNumber.prototype = 5;
function WithNull() {}
WithNull.prototype = null;
function Plain() {}
const bound = Plain.bind(null);
attempt("Map for a number", () => {
  const made = Reflect.construct(Map, [], WithNumber);
  made.set(1, 2);
  show("Map for a number", Object.getPrototypeOf(made) === Map.prototype, made.get(1), made.size);
});
attempt("Map for null", () => {
  const made = Reflect.construct(Map, [[[1, 2]]], WithNull);
  show("Map for null", Object.getPrototypeOf(made) === Map.prototype, made.get(1), made.size);
});
attempt("Map for a bound function", () => {
  const made = Reflect.construct(Map, [], bound);
  made.set(1, 2);
  show("Map for a bound function", Object.getPrototypeOf(made) === Map.prototype, made.get(1));
});
attempt("Object for a number", () => {
  const given = { given: true };
  const made = Reflect.construct(Object, [given], WithNumber);
  made.extra = 1;
  show("Object for a number", made === given, Object.getPrototypeOf(made) === Object.prototype, given.extra, made.hasOwnProperty("extra"));
});
attempt("Object for a bound function", () => {
  const given = { given: true };
  const made = Reflect.construct(Object, [given], bound);
  made.extra = 1;
  show("Object for a bound function", made === given, Object.getPrototypeOf(made) === Object.prototype, given.extra);
});
attempt("Array for null", () => {
  const made = Reflect.construct(Array, [1, 2, 3], WithNull);
  made.push(4);
  show("Array for null", Object.getPrototypeOf(made) === Array.prototype, made.length, made.join());
});
attempt("Error for a number", () => {
  const made = Reflect.construct(Error, ["message"], WithNumber);
  show("Error for a number", Object.getPrototypeOf(made) === Error.prototype, made.message, String(made));
});
attempt("Uint8Array for null", () => {
  const made = Reflect.construct(Uint8Array, [2], WithNull);
  made[0] = 7;
  show("Uint8Array for null", Object.getPrototypeOf(made) === Uint8Array.prototype, made.length, made[0]);
});
attempt("Promise for a number", () => {
  const made = Reflect.construct(Promise, [resolve => resolve(1)], WithNumber);
  show("Promise for a number", Object.getPrototypeOf(made) === Promise.prototype, typeof made.then);
});
// The prototype changes between two constructions.
function Moving() {}
attempt("a prototype that moves", () => {
  const first = Reflect.construct(Set, [], Moving);
  Moving.prototype = { mark: "second", __proto__: Set.prototype };
  const second = Reflect.construct(Set, [], Moving);
  second.add(1);
  show("a prototype that moves", first.mark, second.mark, second.size, Object.getPrototypeOf(first) === Object.getPrototypeOf(second));
});
// new.target is a proxy, whose trap says what the prototype is.
attempt("a proxy as new.target", () => {
  const handed = { mark: "handed", __proto__: Map.prototype };
  const proxy = new Proxy(Plain, { get(target, key) { return key === "prototype" ? handed : target[key]; } });
  const made = Reflect.construct(Map, [], proxy);
  made.set(1, 2);
  show("a proxy as new.target", made.mark, made.get(1), Object.getPrototypeOf(made) === handed);
  const given = { given: true };
  const object = Reflect.construct(Object, [given], proxy);
  show("Object for a proxy", object === given, object.mark);
});
// What cannot construct.
attempt("an arrow as new.target", () => Reflect.construct(Map, [], () => {}));
attempt("a method as new.target", () => Reflect.construct(Object, [{}], { method() {} }.method));
attempt("a number as new.target", () => Reflect.construct(Object, [{}], 5));
// Proxy takes no notice of new.target.
attempt("Proxy reflected", () => {
  const target = { held: 1 };
  const made = Reflect.construct(Proxy, [target, {}], Plain);
  made.extra = 2;
  show("Proxy reflected", made.held, target.extra, made instanceof Plain);
});
// A class whose parent is decided at run time.
function parentOf(flag) { return flag ? Object : Map; }
for (const flag of [true, false]) {
  attempt("a parent decided late", () => {
    class Below extends parentOf(flag) {
      tag = 1;
      constructor(value) { super(value); this.late = 2; }
    }
    const given = flag ? { given: true } : [[1, 2]];
    const made = new Below(given);
    show("a parent decided late", flag, made === given, made.tag, made.late, made instanceof Map, flag ? made.given : made.get(1));
  });
}
// The parent is changed behind the class.
attempt("a parent that is changed", () => {
  class Below extends Map {
    tag = 1;
    constructor(value) { super(value); }
  }
  Object.setPrototypeOf(Below, Object);
  const given = { given: true };
  const made = new Below(given);
  show("a parent that is changed", made === given, made.tag, made.given, made instanceof Map, Object.prototype.toString.call(made));
});
