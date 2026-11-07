// A prototype that would close a cycle is refused: Object.setPrototypeOf and a store to __proto__ throw, Reflect.setPrototypeOf
// answers false. The functions and classes go on as they were. A new prototype object above the old one closes no cycle.
import { inherits } from "node:util";

function show(label, run) {
  try {
    console.log(label, String(run()));
  } catch (error) {
    console.log(label, "throws", error.constructor.name, error.message);
  }
}

console.log("Object.setPrototypeOf");
function Maker1() {
  this.x = 1;
}
Maker1.prototype.hello = function () {
  return "maker " + this.x;
};
class Target1 extends Maker1 {
  y = 2;
  hi() {
    return "target " + this.y + " " + this.hello();
  }
}
show("link", () => Object.setPrototypeOf(Maker1.prototype, Target1.prototype) === Maker1.prototype);
show("  objects", () =>
  [Object.keys(new Maker1()), Object.keys(new Target1()), new Target1().hi(), new Maker1().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker1().absent, new Target1().absent, "absent" in new Maker1(), "absent" in new Target1()].join(),
);
show("  instanceof", () => [new Target1() instanceof Maker1, new Maker1() instanceof Target1].join());
show("  above", () =>
  [Object.getPrototypeOf(Maker1.prototype) === Target1.prototype, Object.getPrototypeOf(Maker1) === Target1].join(),
);

console.log("Reflect.setPrototypeOf");
function Maker2() {
  this.x = 1;
}
Maker2.prototype.hello = function () {
  return "maker " + this.x;
};
class Target2 extends Maker2 {
  y = 2;
  hi() {
    return "target " + this.y + " " + this.hello();
  }
}
show("link", () => Reflect.setPrototypeOf(Maker2.prototype, Target2.prototype));
show("  objects", () =>
  [Object.keys(new Maker2()), Object.keys(new Target2()), new Target2().hi(), new Maker2().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker2().absent, new Target2().absent, "absent" in new Maker2(), "absent" in new Target2()].join(),
);
show("  instanceof", () => [new Target2() instanceof Maker2, new Maker2() instanceof Target2].join());
show("  above", () =>
  [Object.getPrototypeOf(Maker2.prototype) === Target2.prototype, Object.getPrototypeOf(Maker2) === Target2].join(),
);

console.log("a store to __proto__");
function Maker3() {
  this.x = 1;
}
Maker3.prototype.hello = function () {
  return "maker " + this.x;
};
class Target3 extends Maker3 {
  y = 2;
  hi() {
    return "target " + this.y + " " + this.hello();
  }
}
show("link", () => {
  Maker3.prototype.__proto__ = Target3.prototype;
  return "stored";
});
show("  objects", () =>
  [Object.keys(new Maker3()), Object.keys(new Target3()), new Target3().hi(), new Maker3().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker3().absent, new Target3().absent, "absent" in new Maker3(), "absent" in new Target3()].join(),
);
show("  instanceof", () => [new Target3() instanceof Maker3, new Maker3() instanceof Target3].join());
show("  above", () =>
  [Object.getPrototypeOf(Maker3.prototype) === Target3.prototype, Object.getPrototypeOf(Maker3) === Target3].join(),
);

console.log("a store to __proto__ in brackets");
function Maker4() {
  this.x = 1;
}
Maker4.prototype.hello = function () {
  return "maker " + this.x;
};
class Target4 extends Maker4 {
  y = 2;
  hi() {
    return "target " + this.y + " " + this.hello();
  }
}
show("link", () => {
  Maker4.prototype["__proto__"] = Target4.prototype;
  return "stored";
});
show("  objects", () =>
  [Object.keys(new Maker4()), Object.keys(new Target4()), new Target4().hi(), new Maker4().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker4().absent, new Target4().absent, "absent" in new Maker4(), "absent" in new Target4()].join(),
);
show("  instanceof", () => [new Target4() instanceof Maker4, new Maker4() instanceof Target4].join());
show("  above", () =>
  [Object.getPrototypeOf(Maker4.prototype) === Target4.prototype, Object.getPrototypeOf(Maker4) === Target4].join(),
);

console.log("the setter of __proto__ is called");
function Maker5() {
  this.x = 1;
}
Maker5.prototype.hello = function () {
  return "maker " + this.x;
};
class Target5 extends Maker5 {
  y = 2;
  hi() {
    return "target " + this.y + " " + this.hello();
  }
}
show("link", () =>
  Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").set.call(Maker5.prototype, Target5.prototype),
);
show("  objects", () =>
  [Object.keys(new Maker5()), Object.keys(new Target5()), new Target5().hi(), new Maker5().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker5().absent, new Target5().absent, "absent" in new Maker5(), "absent" in new Target5()].join(),
);
show("  instanceof", () => [new Target5() instanceof Maker5, new Maker5() instanceof Target5].join());
show("  above", () =>
  [Object.getPrototypeOf(Maker5.prototype) === Target5.prototype, Object.getPrototypeOf(Maker5) === Target5].join(),
);

console.log("a property named __proto__ is defined");
function Maker6() {
  this.x = 1;
}
Maker6.prototype.hello = function () {
  return "maker " + this.x;
};
class Target6 extends Maker6 {
  y = 2;
  hi() {
    return "target " + this.y + " " + this.hello();
  }
}
show("link", () =>
  Object.getOwnPropertyNames(Object.defineProperty(Maker6.prototype, "__proto__", { value: Target6.prototype })).join(),
);
show("  objects", () =>
  [Object.keys(new Maker6()), Object.keys(new Target6()), new Target6().hi(), new Maker6().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker6().absent, new Target6().absent, "absent" in new Maker6(), "absent" in new Target6()].join(),
);
show("  instanceof", () => [new Target6() instanceof Maker6, new Maker6() instanceof Target6].join());
show("  above", () =>
  [Object.getPrototypeOf(Maker6.prototype) === Target6.prototype, Object.getPrototypeOf(Maker6) === Target6].join(),
);

console.log("inherits");
function Maker7() {
  this.x = 1;
}
Maker7.prototype.hello = function () {
  return "maker " + this.x;
};
class Target7 extends Maker7 {
  y = 2;
  hi() {
    return "target " + this.y + " " + this.hello();
  }
}
show("link", () => inherits(Maker7, Target7));
show("  objects", () =>
  [Object.keys(new Maker7()), Object.keys(new Target7()), new Target7().hi(), new Maker7().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker7().absent, new Target7().absent, "absent" in new Maker7(), "absent" in new Target7()].join(),
);
show("  instanceof", () => [new Target7() instanceof Maker7, new Maker7() instanceof Target7].join());
show("  above", () =>
  [Object.getPrototypeOf(Maker7.prototype) === Target7.prototype, Object.getPrototypeOf(Maker7) === Target7].join(),
);

console.log("a function that links its parameters");
function Maker8() {
  this.x = 1;
}
Maker8.prototype.hello = function () {
  return "maker " + this.x;
};
class Target8 extends Maker8 {
  y = 2;
  hi() {
    return "target " + this.y + " " + this.hello();
  }
}
function link8(child, parent) {
  Object.setPrototypeOf(child.prototype, parent.prototype);
}
show("link", () => link8(Maker8, Target8));
show("  objects", () =>
  [Object.keys(new Maker8()), Object.keys(new Target8()), new Target8().hi(), new Maker8().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker8().absent, new Target8().absent, "absent" in new Maker8(), "absent" in new Target8()].join(),
);
show("  instanceof", () => [new Target8() instanceof Maker8, new Maker8() instanceof Target8].join());
show("  above", () =>
  [Object.getPrototypeOf(Maker8.prototype) === Target8.prototype, Object.getPrototypeOf(Maker8) === Target8].join(),
);

console.log("a link that never runs");
function Maker9() {
  this.x = 1;
}
Maker9.prototype.hello = function () {
  return "maker " + this.x;
};
class Target9 extends Maker9 {
  y = 2;
  hi() {
    return "target " + this.y + " " + this.hello();
  }
}
if (globalThis.nobodySetsThis) Object.setPrototypeOf(Maker9.prototype, Target9.prototype);
show("  objects", () =>
  [Object.keys(new Maker9()), Object.keys(new Target9()), new Target9().hi(), new Maker9().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker9().absent, new Target9().absent, "absent" in new Maker9(), "absent" in new Target9()].join(),
);
show("  instanceof", () => [new Target9() instanceof Maker9, new Maker9() instanceof Target9].join());
show("  above", () =>
  [Object.getPrototypeOf(Maker9.prototype) === Target9.prototype, Object.getPrototypeOf(Maker9) === Target9].join(),
);

console.log("three times");
function Maker10() {
  this.x = 1;
}
Maker10.prototype.hello = function () {
  return "maker " + this.x;
};
class Target10 extends Maker10 {
  y = 2;
  hi() {
    return "target " + this.y + " " + this.hello();
  }
}
for (let turn = 0; turn < 3; turn++)
  show("link", () => Object.setPrototypeOf(Maker10.prototype, Target10.prototype) === Maker10.prototype);
show("  objects", () =>
  [Object.keys(new Maker10()), Object.keys(new Target10()), new Target10().hi(), new Maker10().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker10().absent, new Target10().absent, "absent" in new Maker10(), "absent" in new Target10()].join(),
);
show("  instanceof", () => [new Target10() instanceof Maker10, new Maker10() instanceof Target10].join());
show("  above", () =>
  [Object.getPrototypeOf(Maker10.prototype) === Target10.prototype, Object.getPrototypeOf(Maker10) === Target10].join(),
);

console.log("many times");
function Maker11() {
  this.x = 1;
}
Maker11.prototype.hello = function () {
  return "maker " + this.x;
};
class Target11 extends Maker11 {
  y = 2;
  hi() {
    return "target " + this.y + " " + this.hello();
  }
}
let refused11 = 0;
for (let turn = 0; turn < 20000; turn++)
  refused11 += Reflect.setPrototypeOf(Maker11.prototype, Target11.prototype) ? 0 : 1;
console.log("refused", refused11);
show("  objects", () =>
  [Object.keys(new Maker11()), Object.keys(new Target11()), new Target11().hi(), new Maker11().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker11().absent, new Target11().absent, "absent" in new Maker11(), "absent" in new Target11()].join(),
);
show("  instanceof", () => [new Target11() instanceof Maker11, new Maker11() instanceof Target11].join());
show("  above", () =>
  [Object.getPrototypeOf(Maker11.prototype) === Target11.prototype, Object.getPrototypeOf(Maker11) === Target11].join(),
);

console.log("a frozen prototype object");
function Maker12() {
  this.x = 1;
}
Maker12.prototype.hello = function () {
  return "maker " + this.x;
};
class Target12 extends Maker12 {
  y = 2;
  hi() {
    return "target " + this.y + " " + this.hello();
  }
}
Object.freeze(Maker12.prototype);
show("link", () => Object.setPrototypeOf(Maker12.prototype, Target12.prototype) === Maker12.prototype);
show("link", () => Reflect.setPrototypeOf(Maker12.prototype, Target12.prototype));
show("  objects", () =>
  [Object.keys(new Maker12()), Object.keys(new Target12()), new Target12().hi(), new Maker12().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker12().absent, new Target12().absent, "absent" in new Maker12(), "absent" in new Target12()].join(),
);
show("  instanceof", () => [new Target12() instanceof Maker12, new Maker12() instanceof Target12].join());
show("  above", () =>
  [Object.getPrototypeOf(Maker12.prototype) === Target12.prototype, Object.getPrototypeOf(Maker12) === Target12].join(),
);

console.log("a prototype object that takes no more properties");
function Maker13() {
  this.x = 1;
}
Maker13.prototype.hello = function () {
  return "maker " + this.x;
};
class Target13 extends Maker13 {
  y = 2;
  hi() {
    return "target " + this.y + " " + this.hello();
  }
}
Object.preventExtensions(Maker13.prototype);
show("link", () => Object.setPrototypeOf(Maker13.prototype, Target13.prototype) === Maker13.prototype);
show("link", () => Reflect.setPrototypeOf(Maker13.prototype, Target13.prototype));
show("the one it has", () => Reflect.setPrototypeOf(Maker13.prototype, Object.prototype));
show("  objects", () =>
  [Object.keys(new Maker13()), Object.keys(new Target13()), new Target13().hi(), new Maker13().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker13().absent, new Target13().absent, "absent" in new Maker13(), "absent" in new Target13()].join(),
);
show("  instanceof", () => [new Target13() instanceof Maker13, new Maker13() instanceof Target13].join());
show("  above", () =>
  [Object.getPrototypeOf(Maker13.prototype) === Target13.prototype, Object.getPrototypeOf(Maker13) === Target13].join(),
);

console.log("an instance");
function Maker14() {
  this.x = 1;
}
Maker14.prototype.hello = function () {
  return "maker " + this.x;
};
class Target14 extends Maker14 {
  y = 2;
  hi() {
    return "target " + this.y + " " + this.hello();
  }
}
const held14 = new Target14();
show("link", () => Object.setPrototypeOf(Maker14.prototype, held14) === Maker14.prototype);
show("link", () => Reflect.setPrototypeOf(Maker14.prototype, Object.create(held14)));
show("itself", () => Reflect.setPrototypeOf(held14, held14));
show("held", () => held14.hi());
show("  objects", () =>
  [Object.keys(new Maker14()), Object.keys(new Target14()), new Target14().hi(), new Maker14().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker14().absent, new Target14().absent, "absent" in new Maker14(), "absent" in new Target14()].join(),
);
show("  instanceof", () => [new Target14() instanceof Maker14, new Maker14() instanceof Target14].join());
show("  above", () =>
  [Object.getPrototypeOf(Maker14.prototype) === Target14.prototype, Object.getPrototypeOf(Maker14) === Target14].join(),
);

console.log("the function itself");
function Maker15() {
  this.x = 1;
}
Maker15.prototype.hello = function () {
  return "maker " + this.x;
};
class Target15 extends Maker15 {
  y = 2;
  hi() {
    return "target " + this.y + " " + this.hello();
  }
}
show("link", () => Object.setPrototypeOf(Maker15, Target15) === Maker15);
show("link", () => Reflect.setPrototypeOf(Maker15, Target15));
show("link", () => {
  Maker15.__proto__ = Target15;
  return "stored";
});
show("  objects", () =>
  [Object.keys(new Maker15()), Object.keys(new Target15()), new Target15().hi(), new Maker15().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker15().absent, new Target15().absent, "absent" in new Maker15(), "absent" in new Target15()].join(),
);
show("  instanceof", () => [new Target15() instanceof Maker15, new Maker15() instanceof Target15].join());
show("  above", () =>
  [Object.getPrototypeOf(Maker15.prototype) === Target15.prototype, Object.getPrototypeOf(Maker15) === Target15].join(),
);

console.log("a bound function");
function Maker16() {
  this.x = 1;
}
Maker16.prototype.hello = function () {
  return "maker " + this.x;
};
class Target16 extends Maker16 {
  y = 2;
  hi() {
    return "target " + this.y + " " + this.hello();
  }
}
const Bound16 = Target16.bind(null);
show("link", () => Reflect.setPrototypeOf(Maker16, Bound16));
show("link", () => Object.setPrototypeOf(Maker16, Bound16) === Maker16);
show("bound", () => [new Bound16().hi(), new Target16() instanceof Bound16].join());
show("  objects", () =>
  [Object.keys(new Maker16()), Object.keys(new Target16()), new Target16().hi(), new Maker16().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker16().absent, new Target16().absent, "absent" in new Maker16(), "absent" in new Target16()].join(),
);
show("  instanceof", () => [new Target16() instanceof Maker16, new Maker16() instanceof Target16].join());
show("  above", () =>
  [Object.getPrototypeOf(Maker16.prototype) === Target16.prototype, Object.getPrototypeOf(Maker16) === Target16].join(),
);

console.log("a new prototype object made by Object.create");
function Maker17() {
  this.x = 1;
}
Maker17.prototype.hello = function () {
  return "maker " + this.x;
};
class Target17 extends Maker17 {
  y = 2;
  hi() {
    return "target " + this.y + " " + this.hello();
  }
}
Maker17.prototype = Object.create(Target17.prototype);
show("  objects", () =>
  [Object.keys(new Maker17()), Object.keys(new Target17()), new Target17().hi(), new Maker17().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker17().absent, new Target17().absent, "absent" in new Maker17(), "absent" in new Target17()].join(),
);
show("  instanceof", () => [new Target17() instanceof Maker17, new Maker17() instanceof Target17].join());
show("  above", () =>
  [Object.getPrototypeOf(Maker17.prototype) === Target17.prototype, Object.getPrototypeOf(Maker17) === Target17].join(),
);

console.log("a new prototype object written as a literal");
function Maker18() {
  this.x = 1;
}
Maker18.prototype.hello = function () {
  return "maker " + this.x;
};
class Target18 extends Maker18 {
  y = 2;
  hi() {
    return "target " + this.y + " " + this.hello();
  }
}
Maker18.prototype = {
  __proto__: Target18.prototype,
  hello() {
    return "new " + this.x;
  },
};
show("  objects", () =>
  [Object.keys(new Maker18()), Object.keys(new Target18()), new Target18().hi(), new Maker18().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker18().absent, new Target18().absent, "absent" in new Maker18(), "absent" in new Target18()].join(),
);
show("  instanceof", () => [new Target18() instanceof Maker18, new Maker18() instanceof Target18].join());
show("  above", () =>
  [Object.getPrototypeOf(Maker18.prototype) === Target18.prototype, Object.getPrototypeOf(Maker18) === Target18].join(),
);

console.log("a new prototype object that is an instance");
function Maker19() {
  this.x = 1;
}
Maker19.prototype.hello = function () {
  return "maker " + this.x;
};
class Target19 extends Maker19 {
  y = 2;
  hi() {
    return "target " + this.y + " " + this.hello();
  }
}
Maker19.prototype = new Target19();
show("  objects", () =>
  [Object.keys(new Maker19()), Object.keys(new Target19()), new Target19().hi(), new Maker19().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker19().absent, new Target19().absent, "absent" in new Maker19(), "absent" in new Target19()].join(),
);
show("  instanceof", () => [new Target19() instanceof Maker19, new Maker19() instanceof Target19].join());
show("  above", () =>
  [Object.getPrototypeOf(Maker19.prototype) === Target19.prototype, Object.getPrototypeOf(Maker19) === Target19].join(),
);

console.log("another prototype after the refusal");
function Maker20() {
  this.x = 1;
}
Maker20.prototype.hello = function () {
  return "maker " + this.x;
};
class Target20 extends Maker20 {
  y = 2;
  hi() {
    return "target " + this.y + " " + this.hello();
  }
}
class Other20 {
  other() {
    return "other";
  }
}
show("link", () => Reflect.setPrototypeOf(Maker20.prototype, Target20.prototype));
show("link", () => Reflect.setPrototypeOf(Maker20.prototype, Other20.prototype));
show("link", () => Reflect.setPrototypeOf(Other20.prototype, Target20.prototype));
show("other", () => new Target20().other() + new Maker20().other());
show("  objects", () =>
  [Object.keys(new Maker20()), Object.keys(new Target20()), new Target20().hi(), new Maker20().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker20().absent, new Target20().absent, "absent" in new Maker20(), "absent" in new Target20()].join(),
);
show("  instanceof", () => [new Target20() instanceof Maker20, new Maker20() instanceof Target20].join());
show("  above", () =>
  [Object.getPrototypeOf(Maker20.prototype) === Target20.prototype, Object.getPrototypeOf(Maker20) === Target20].join(),
);

console.log("the other way round once the class is unlinked");
function Maker21() {
  this.x = 1;
}
Maker21.prototype.hello = function () {
  return "maker " + this.x;
};
class Target21 extends Maker21 {
  y = 2;
  hi() {
    return "target " + this.y + " " + this.hello();
  }
}
show("unlink", () => Reflect.setPrototypeOf(Target21.prototype, Object.prototype));
show("link", () => Reflect.setPrototypeOf(Maker21.prototype, Target21.prototype));
show("link", () => Reflect.setPrototypeOf(Target21.prototype, Maker21.prototype));
show("members", () => [typeof new Maker21().hi, typeof new Target21().hello].join());
show("  objects", () =>
  [Object.keys(new Maker21()), Object.keys(new Target21()), new Target21().hi(), new Maker21().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker21().absent, new Target21().absent, "absent" in new Maker21(), "absent" in new Target21()].join(),
);
show("  instanceof", () => [new Target21() instanceof Maker21, new Maker21() instanceof Target21].join());
show("  above", () =>
  [Object.getPrototypeOf(Maker21.prototype) === Target21.prototype, Object.getPrototypeOf(Maker21) === Target21].join(),
);

console.log("members change after the refusal");
function Maker22() {
  this.x = 1;
}
Maker22.prototype.hello = function () {
  return "maker " + this.x;
};
class Target22 extends Maker22 {
  y = 2;
  hi() {
    return "target " + this.y + " " + this.hello();
  }
}
show("link", () => Reflect.setPrototypeOf(Maker22.prototype, Target22.prototype));
Maker22.prototype.late = function () {
  return "late " + this.x;
};
Maker22.prototype.hello = function () {
  return "replaced " + this.late();
};
show("  objects", () =>
  [Object.keys(new Maker22()), Object.keys(new Target22()), new Target22().hi(), new Maker22().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker22().absent, new Target22().absent, "absent" in new Maker22(), "absent" in new Target22()].join(),
);
show("  instanceof", () => [new Target22() instanceof Maker22, new Maker22() instanceof Target22].join());
show("  above", () =>
  [Object.getPrototypeOf(Maker22.prototype) === Target22.prototype, Object.getPrototypeOf(Maker22) === Target22].join(),
);

console.log("a function, a class and a class");
function Maker23() {
  this.x = 1;
}
Maker23.prototype.hello = function () {
  return "maker " + this.x;
};
class Middle23 extends Maker23 {
  m = 3;
}
class Target23 extends Middle23 {
  y = 2;
  hi() {
    return "target " + this.y + " " + this.hello();
  }
}
show("link", () => Object.setPrototypeOf(Maker23.prototype, Target23.prototype) === Maker23.prototype);
show("link", () => Reflect.setPrototypeOf(Maker23.prototype, Middle23.prototype));
show("  objects", () =>
  [Object.keys(new Maker23()), Object.keys(new Target23()), new Target23().hi(), new Maker23().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker23().absent, new Target23().absent, "absent" in new Maker23(), "absent" in new Target23()].join(),
);
show("  instanceof", () => [new Target23() instanceof Maker23, new Maker23() instanceof Target23].join());
show("  above", () =>
  [Object.getPrototypeOf(Maker23.prototype) === Target23.prototype, Object.getPrototypeOf(Maker23) === Target23].join(),
);

console.log("a function, a class and a function");
function Maker24() {
  this.x = 1;
}
Maker24.prototype.hello = function () {
  return "maker " + this.x;
};
class Middle24 extends Maker24 {
  m = 3;
}
function Target24() {
  this.x = 5;
  this.y = 2;
}
Object.setPrototypeOf(Target24.prototype, Middle24.prototype);
Target24.prototype.hi = function () {
  return "target " + this.y + " " + this.hello();
};
show("link", () => Object.setPrototypeOf(Maker24.prototype, Target24.prototype) === Maker24.prototype);
show("link", () => Reflect.setPrototypeOf(Maker24.prototype, Middle24.prototype));
show("  objects", () =>
  [Object.keys(new Maker24()), Object.keys(new Target24()), new Target24().hi(), new Maker24().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker24().absent, new Target24().absent, "absent" in new Maker24(), "absent" in new Target24()].join(),
);
show("  instanceof", () => [new Target24() instanceof Maker24, new Maker24() instanceof Target24].join());
show("  above", () =>
  [Object.getPrototypeOf(Maker24.prototype) === Target24.prototype, Object.getPrototypeOf(Maker24) === Target24].join(),
);

console.log("a function, a class and a function, a new prototype object");
function Maker25() {
  this.x = 1;
}
Maker25.prototype.hello = function () {
  return "maker " + this.x;
};
class Middle25 extends Maker25 {
  m = 3;
}
function Target25() {
  this.x = 5;
  this.y = 2;
}
Object.setPrototypeOf(Target25.prototype, Middle25.prototype);
Target25.prototype.hi = function () {
  return "target " + this.y + " " + this.hello();
};
Maker25.prototype = Object.create(Target25.prototype);
show("  objects", () =>
  [Object.keys(new Maker25()), Object.keys(new Target25()), new Target25().hi(), new Maker25().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker25().absent, new Target25().absent, "absent" in new Maker25(), "absent" in new Target25()].join(),
);
show("  instanceof", () => [new Target25() instanceof Maker25, new Maker25() instanceof Target25].join());
show("  above", () =>
  [Object.getPrototypeOf(Maker25.prototype) === Target25.prototype, Object.getPrototypeOf(Maker25) === Target25].join(),
);

console.log("two functions");
function Maker26() {
  this.x = 1;
}
Maker26.prototype.hello = function () {
  return "maker " + this.x;
};
function Target26() {
  Maker26.call(this);
  this.y = 2;
}
Object.setPrototypeOf(Target26.prototype, Maker26.prototype);
Target26.prototype.hi = function () {
  return "target " + this.y + " " + this.hello();
};
show("link", () => Object.setPrototypeOf(Maker26.prototype, Target26.prototype) === Maker26.prototype);
show("link", () => Reflect.setPrototypeOf(Maker26.prototype, Target26.prototype));
show("  objects", () =>
  [Object.keys(new Maker26()), Object.keys(new Target26()), new Target26().hi(), new Maker26().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker26().absent, new Target26().absent, "absent" in new Maker26(), "absent" in new Target26()].join(),
);
show("  instanceof", () => [new Target26() instanceof Maker26, new Maker26() instanceof Target26].join());
show("  above", () =>
  [Object.getPrototypeOf(Maker26.prototype) === Target26.prototype, Object.getPrototypeOf(Maker26) === Target26].join(),
);

console.log("two classes");
class Maker27 {
  x = 1;
  hello() {
    return "maker " + this.x;
  }
}
class Target27 extends Maker27 {
  y = 2;
  hi() {
    return "target " + this.y + " " + this.hello();
  }
}
show("link", () => Object.setPrototypeOf(Maker27.prototype, Target27.prototype) === Maker27.prototype);
show("link", () => Reflect.setPrototypeOf(Maker27.prototype, Target27.prototype));
show("link", () => Reflect.setPrototypeOf(Maker27, Target27));
show("  objects", () =>
  [Object.keys(new Maker27()), Object.keys(new Target27()), new Target27().hi(), new Maker27().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker27().absent, new Target27().absent, "absent" in new Maker27(), "absent" in new Target27()].join(),
);
show("  instanceof", () => [new Target27() instanceof Maker27, new Maker27() instanceof Target27].join());
show("  above", () =>
  [Object.getPrototypeOf(Maker27.prototype) === Target27.prototype, Object.getPrototypeOf(Maker27) === Target27].join(),
);

console.log("a proxy in between");
function Maker28() {
  this.x = 1;
}
Maker28.prototype.hello = function () {
  return "maker " + this.x;
};
class Target28 extends Maker28 {
  y = 2;
  hi() {
    return "target " + this.y + " " + this.hello();
  }
}
show("link", () => Reflect.setPrototypeOf(Maker28.prototype, new Proxy(Target28.prototype, {})));
show("  objects", () =>
  [Object.keys(new Maker28()), Object.keys(new Target28()), new Target28().hi(), new Maker28().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker28().absent, new Target28().absent, "absent" in new Maker28(), "absent" in new Target28()].join(),
);
show("  instanceof", () => new Target28() instanceof Maker28);
show("  stores", () => {
  const object = new Target28();
  object.x = 7;
  object.fresh = 8;
  return object.x;
});
show("  names", () => {
  const names = [];
  for (const name in new Target28()) names.push(name);
  return names.join();
});
show("  above", () =>
  [Object.getPrototypeOf(Maker28.prototype) === Target28.prototype, Object.getPrototypeOf(Maker28) === Target28].join(),
);

console.log("a proxy in between two classes");
class Maker29 {
  x = 1;
  hello() {
    return "maker " + this.x;
  }
}
class Target29 extends Maker29 {
  y = 2;
  hi() {
    return "target " + this.y + " " + this.hello();
  }
}
show("link", () => Object.setPrototypeOf(Maker29.prototype, new Proxy(Target29.prototype, {})) === Maker29.prototype);
show("  objects", () =>
  [Object.keys(new Maker29()), Object.keys(new Target29()), new Target29().hi(), new Maker29().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker29().absent, new Target29().absent, "absent" in new Maker29(), "absent" in new Target29()].join(),
);
show("  instanceof", () => new Target29() instanceof Maker29);
show("  stores", () => {
  const object = new Target29();
  object.x = 7;
  object.fresh = 8;
  return object.x;
});
show("  names", () => {
  const names = [];
  for (const name in new Target29()) names.push(name);
  return names.join();
});
show("  above", () =>
  [Object.getPrototypeOf(Maker29.prototype) === Target29.prototype, Object.getPrototypeOf(Maker29) === Target29].join(),
);

console.log("a proxy that stops answering");
function Maker30() {
  this.x = 1;
}
Maker30.prototype.hello = function () {
  return "maker " + this.x;
};
class Target30 extends Maker30 {
  y = 2;
  hi() {
    return "target " + this.y + " " + this.hello();
  }
}
let asked30 = 0;
const handler30 = {
  get(target, key, receiver) {
    return ++asked30 > 3 ? "enough" : Reflect.get(target, key, receiver);
  },
  has(target, key) {
    return ++asked30 > 6 ? false : Reflect.has(target, key);
  },
};
show("link", () => Reflect.setPrototypeOf(Maker30.prototype, new Proxy(Target30.prototype, handler30)));
show("  objects", () =>
  [Object.keys(new Maker30()), Object.keys(new Target30()), new Target30().hi(), new Maker30().hello()].join(" | "),
);
show("  absent", () =>
  [new Maker30().absent, new Target30().absent, "absent" in new Maker30(), "absent" in new Target30()].join(),
);
show("  instanceof", () => new Target30() instanceof Maker30);
show("  stores", () => {
  const object = new Target30();
  object.x = 7;
  object.fresh = 8;
  return object.x;
});
show("  names", () => {
  const names = [];
  for (const name in new Target30()) names.push(name);
  return names.join();
});
show("  above", () =>
  [Object.getPrototypeOf(Maker30.prototype) === Target30.prototype, Object.getPrototypeOf(Maker30) === Target30].join(),
);

console.log("classes below built-in classes");
class OwnError extends Error {}
class OwnList extends Array {}
show("link", () => Reflect.setPrototypeOf(Error.prototype, OwnError.prototype));
show("link", () => Reflect.setPrototypeOf(Error, OwnError));
show("link", () => Reflect.setPrototypeOf(Array.prototype, OwnList.prototype));
show("link", () => Reflect.setPrototypeOf(Object.prototype, OwnList.prototype));
show("  objects", () =>
  [new OwnError("text").message, new OwnError() instanceof Error, OwnList.of(1, 2).map(x => x * 2)].join(" | "),
);

console.log("classes that name each other");
show("define", () => {
  class First extends Second {}
  class Second extends First {}
  return new First();
});

console.log("plain objects");
const first = { a: 1 };
const second = Object.create(first);
const third = { __proto__: second, c: 3 };
show("link", () => Object.setPrototypeOf(first, second) === first);
show("link", () => Reflect.setPrototypeOf(first, third));
show("link", () => {
  first.__proto__ = third;
  return "stored";
});
show("  objects", () => [third.a, third.c, third.absent, Object.getPrototypeOf(first) === Object.prototype].join());
