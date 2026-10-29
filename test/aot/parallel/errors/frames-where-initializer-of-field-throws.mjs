// Stack frames where the initializer of a field throws.
function frames(error) {
  return String(error?.stack)
    .split("\n")
    .filter(line => line.trimStart().startsWith("at "))
    .slice(0, 3)
    .map(line => line.trim().replace(/\(?[^ (]*[\\/]([^\\/]*)\)?$/, "$1"))
    .join(" | ");
}
function thrower() {
  throw new RangeError("thrown");
}
const cases = {
  "a read of null": () =>
    new (class A {
      field = null.member;
    })(),
  "a method that is missing": () =>
    new (class B {
      field = this.method();
    })(),
  "a name that is missing": () =>
    new (class C {
      field = missing;
    })(),
  "below a parent": () =>
    new (class D extends Object {
      field = null.member;
    })(),
  "a private field": () =>
    new (class E {
      #hidden = null.member;
    })(),
  "a static field": () =>
    class F {
      static field = null.member;
    },
  "a written constructor": () =>
    new (class G {
      field = null.member;
      constructor() {}
    })(),
  "a written constructor below a parent": () =>
    new (class G2 extends Object {
      field = null.member;
      constructor() {
        super();
      }
    })(),
  "the second field": () =>
    new (class H {
      first = 1;
      field = null.member;
    })(),
  "a throw in a call": () =>
    new (class I {
      field = thrower();
    })(),
  "a throw in a call of a static field": () =>
    class I2 {
      static field = thrower();
    },
  "a static block": () =>
    class K {
      static {
        null.member;
      }
    },
  "a computed key": () =>
    new (class L {
      [null.member] = 1;
    })(),
  "an arrow in a field": () =>
    new (class M {
      field = (() => null.member)();
    })(),
  "a new target of another class": () =>
    Reflect.construct(
      class J {
        field = this.method();
        method() {}
      },
      [],
      Object,
    ),
};
for (const [label, run] of Object.entries(cases)) {
  try {
    run();
  } catch (error) {
    console.log(label + ":", error.constructor.name, frames(error), "|", error.line, error.column);
  }
}
