// Constructors of classes without a parent hand texts to a direct eval: texts that call super(), that never reach the call, and texts that read this, new.target, arguments, super properties and private names.
function show(label, f) {
  try {
    console.log(label, "returned", typeof f());
  } catch (e) {
    console.log(label, e.constructor.name + ": " + e.message);
  }
}
class B {
  constructor() {
    eval("super()");
  }
}
show("base", () => new B());
class B2 {
  constructor() {
    (() => eval("super()"))();
  }
}
show("base, arrow", () => new B2());
class B3 {
  constructor() {
    eval("(() => super())()");
  }
}
show("base, arrow in the text", () => new B3());
class B4 {
  constructor() {
    eval("eval('super()')");
  }
}
show("base, text in the text", () => new B4());
class B5 {
  constructor() {
    this.a = 1;
    this.seen = eval("(() => this.a)()");
    this.same = eval("this") === this;
    this.target = eval("new.target") === B5;
    this.count = eval("arguments.length");
    this.viaArrow = eval("(() => new.target === B5)()");
  }
}
show("base, this", () => {
  const b = new B5(1, 2);
  console.log(JSON.stringify(b));
  return b;
});
class P6 {
  m() {
    return "P6.m";
  }
}
class B6 {
  constructor() {
    this.got = eval("super.toString === Object.prototype.toString");
    this.arrow = eval("(() => super.hasOwnProperty('got'))()");
  }
}
show("base, super property", () => {
  const b = new B6();
  console.log(JSON.stringify(b));
  return b;
});
class A7 {
  constructor() {
    console.log("A7 runs", new.target.name);
  }
}
class B7 {
  constructor() {
    eval("super()");
  }
}
Object.setPrototypeOf(B7, A7);
show("base, parent given later", () => new B7());
class B8 {
  constructor() {
    eval("super()");
  }
}
Object.setPrototypeOf(B8, null);
show("base, no parent at all", () => new B8());
class B9 {
  constructor() {
    eval("if (false) super()");
    this.ok = true;
  }
}
show("base, never run", () => {
  const b = new B9();
  console.log(JSON.stringify(b));
  return b;
});
class B10 {
  constructor() {
    class Inner {
      static #p = 1;
      static [eval("super()")]() {}
    }
  }
}
show("base, in a computed key", () => new B10());
class B11 {
  constructor() {
    function f() {
      eval("super()");
    }
    f();
  }
}
show("base, inner function", () => new B11());
class B12 {
  constructor(a = eval("super()")) {}
}
show("base, default value", () => new B12());
class B13 {
  x = 1;
  #y = 2;
  constructor() {
    this.sum = eval("this.x + this.#y");
  }
}
show("base, private name", () => {
  const b = new B13();
  console.log(JSON.stringify(b));
  return b;
});
class B14 {
  constructor() {
    var local = 5;
    eval("var made = local + 1");
    this.made = made;
  }
}
show("base, variables", () => {
  const b = new B14();
  console.log(JSON.stringify(b));
  return b;
});
const E15 = class {
  constructor() {
    eval("super()");
  }
};
show("class expression", () => new E15());
class B16 {
  constructor() {
    return eval("(function () { return () => this; }).call(7)()");
  }
}
show("base, function in the text", () => new B16());
class B17 {
  static make() {
    return eval("super()");
  }
}
show("static method", () => B17.make());
class B18 {
  get g() {
    return eval("super()");
  }
}
show("getter", () => new B18().g);
const o19 = {
  m() {
    return eval("super()");
  },
};
show("object method", () => o19.m());
class B20 {
  constructor() {
    for (let i = 0; i < 3; i++) this["v" + i] = eval("(() => this === undefined ? 'none' : i)()");
  }
}
show("base, loop", () => {
  const b = new B20();
  console.log(JSON.stringify(b));
  return b;
});
