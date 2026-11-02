// Stack frames of classes and members named while the program runs.
const top = (s, n = 2) =>
  String(s)
    .split("\n")
    .filter(l => l.trimStart().startsWith("at "))
    .slice(0, n)
    .map(l => l.trim().replace(/ ?\(?[^ (]*:\d+:\d+\)?$/, ""))
    .join(" | ");
class A {
  static name = "S";
  constructor() {
    this.s = new Error("x").stack;
  }
  static m() {
    return new Error("x").stack;
  }
}
console.log("static name", top(new A().s), "/", top(A.m()));
class B {
  static displayName = "D";
  constructor() {
    this.s = new Error("x").stack;
  }
}
console.log("static displayName", top(new B().s));
B.displayName = "D2";
console.log(top(new B().s));
class C {
  static name() {
    return 1;
  }
  constructor() {
    this.s = new Error("x").stack;
  }
}
console.log("static method name", top(new C().s));
class E {
  static get name() {
    return "G";
  }
  constructor() {
    this.s = new Error("x").stack;
  }
}
console.log("static getter name", top(new E().s));
const make = n =>
  class {
    static name = n;
    constructor() {
      this.s = new Error("x").stack;
    }
  };
const M1 = make("m1"),
  M2 = make("m2");
console.log("factory with static name", top(new M1().s), "/", top(new M2().s), "/", top(new M1().s));
const sub = (P, n) =>
  Object.defineProperty(
    class extends P {
      constructor() {
        super();
      }
    },
    "name",
    { value: n },
  );
const S1 = sub(M1, "s1"),
  S2 = sub(M2, "s2");
console.log("derived", top(new S1().s, 3), "/", top(new S2().s, 3));
const fields = n =>
  Object.defineProperty(
    class {
      f = new Error("x").stack;
    },
    "name",
    { value: n },
  );
console.log("field initializer", top(new (fields("f1"))().f, 3), "/", top(new (fields("f2"))().f, 3));
const keyed = k =>
  class {
    [k]() {
      return new Error("x").stack;
    }
    static [k]() {
      return new Error("x").stack;
    }
    get ["g" + k]() {
      return new Error("x").stack;
    }
    set ["s" + k](v) {
      v.s = new Error("x").stack;
    }
  };
const K1 = keyed("k1"),
  K2 = keyed("k2");
const box = {};
console.log(
  "computed members",
  top(new K1().k1()),
  "/",
  top(new K2().k2()),
  "/",
  top(K1.k1()),
  "/",
  top(K2.k2()),
  "/",
  top(new K1().gk1),
  "/",
  top(new K2().gk2),
  "/",
  ((new K2().sk2 = box), top(box.s)),
);
const lit = k => ({
  [k]: function () {
    return new Error("x").stack;
  },
  ["a" + k]: () => new Error("x").stack,
  ["c" + k]: class {
    constructor() {
      this.s = new Error("x").stack;
    }
  },
});
const L1 = lit("l1"),
  L2 = lit("l2");
console.log(
  "computed values",
  top(L1.l1()),
  "/",
  top(L2.l2()),
  "/",
  top(L1.al1()),
  "/",
  top(L2.al2()),
  "/",
  top(new L1.cl1().s),
  "/",
  top(new L2.cl2().s),
);
function helper(f, n) {
  Object.defineProperty(f, "name", { value: n, configurable: true });
  return f;
}
const viaHelper = n =>
  helper(function () {
    return new Error("x").stack;
  }, n);
console.log("through a helper", top(viaHelper("h1")()), "/", top(viaHelper("h2")()));
const assigned = n =>
  Object.assign(
    function () {
      return new Error("x").stack;
    },
    { displayName: n },
  );
console.log("Object.assign displayName", top(assigned("d1")()), "/", top(assigned("d2")()));
const props = n =>
  Object.defineProperties(
    function () {
      return new Error("x").stack;
    },
    { name: { value: n } },
  );
console.log("defineProperties", top(props("p1")()), "/", top(props("p2")()));
const reflected = n => {
  const f = function () {
    return new Error("x").stack;
  };
  Reflect.defineProperty(f, "name", { value: n });
  return f;
};
console.log("Reflect.defineProperty", top(reflected("r1")()), "/", top(reflected("r2")()));
const byKey = (n, k) => {
  const f = function () {
    return new Error("x").stack;
  };
  Object.defineProperty(f, k, { value: n });
  return f;
};
console.log("a key that is a variable", top(byKey("v1", "na" + "me")()), "/", top(byKey("v2", ["name"][0])()));
[1, 2].map(
  Object.defineProperty(
    function (v) {
      if (v === 2) console.log("called by a built-in", top(new Error("x").stack, 3));
    },
    "name",
    { value: "callback" },
  ),
);
const arrow = () => new Error("x").stack;
arrow.displayName = "shownArrow";
console.log("displayName of an arrow", top(arrow()));
const method = {
  m() {
    return new Error("x").stack;
  },
}.m;
method.displayName = "shownMethod";
console.log("displayName of a method", top(method()));
const getter = Object.getOwnPropertyDescriptor(
  {
    get g() {
      return new Error("x").stack;
    },
  },
  "g",
).get;
console.log("a getter", top(getter()));
getter.displayName = "shownGetter";
console.log("displayName of a getter", top(getter()));
const rename = (f, n) => Object.defineProperty(f, "name", { value: n });
function declared() {
  return new Error("x").stack;
}
rename(declared, "once1");
console.log("a declaration", top(declared()));
rename(declared, "twice1");
console.log(top(declared()));
const expression = function () {
  return new Error("x").stack;
};
rename(expression, "once2");
console.log("an expression", top(expression()));
rename(expression, "twice2");
console.log(top(expression()));
const oneArrow = () => new Error("x").stack;
rename(oneArrow, "once3");
console.log("an arrow", top(oneArrow()));
rename(oneArrow, "twice3");
console.log(top(oneArrow()));
const holder = {
  one() {
    return new Error("x").stack;
  },
  get two() {
    return new Error("x").stack;
  },
};
rename(holder.one, "once4");
console.log("a method", top(holder.one()));
rename(holder.one, "twice4");
console.log(top(holder.one()));
rename(Object.getOwnPropertyDescriptor(holder, "two").get, "once5");
console.log("a getter of a literal", top(holder.two));
class Single {
  m() {
    return new Error("x").stack;
  }
  static s() {
    return new Error("x").stack;
  }
  ["c" + 1]() {
    return new Error("x").stack;
  }
}
rename(Single.prototype.m, "once6");
console.log("a method of a class", top(new Single().m()));
rename(Single.s, "once7");
console.log("a static method", top(Single.s()));
console.log("a computed method", top(new Single().c1()));
rename(Single, "once8");
console.log(
  "a class",
  top(
    (() => {
      class Sub extends Single {
        constructor() {
          super();
          this.s = new Error("x").stack;
        }
      }
      return new Sub().s;
    })(),
  ),
);
function* oneGenerator() {
  yield new Error("x").stack;
}
rename(oneGenerator, "once9");
console.log("a generator", top(oneGenerator().next().value));
let captured = 1;
const withCapture = function () {
  captured++;
  return new Error("x").stack;
};
withCapture.displayName = "shownCapture";
console.log("displayName with a capture", top(withCapture()));
