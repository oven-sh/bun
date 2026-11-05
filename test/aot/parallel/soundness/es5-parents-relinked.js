// Constructor functions whose prototype objects seen code links to those of other constructor functions, handed to code that no build sees.
// Each pair is changed in one way, before its first construction or after it: a prototype object is replaced or relinked, an accessor, a read-only property, a proxy or another method
// comes to stand above the new objects. Every store of a constructor, every call of an inherited method and every instanceof answers as the language says.
// The same text is strict as a module and sloppy as CommonJS.
var unseen = new Function("x", "return x");
var lines = [];
var noted = [];

function inherits(constructor, parent) {
  constructor.super_ = parent;
  Object.setPrototypeOf(constructor.prototype, parent.prototype);
}

function attempt(run, argument) {
  try {
    return run(argument);
  } catch (error) {
    return "threw " + error.name;
  }
}

function describe(object) {
  var chain = [];
  for (var above = Object.getPrototypeOf(object); above; above = Object.getPrototypeOf(above))
    chain.push(Object.prototype.hasOwnProperty.call(above, "tag") ? above.tag : "-");
  return Object.keys(object).join() + " " + JSON.stringify(object) + " " + object.b + " " + chain.join(">");
}

// A step runs a few times: what a store, a read or a call keeps from one run is there in the next.
function construct(name, make, argument, probe) {
  var answers = [];
  for (var round = 0; round < 5; round++) {
    var answer = attempt(function () {
      var object = make(argument);
      return describe(object) + (probe ? " " + attempt(probe, object) : "");
    });
    if (noted.length)
      answer += " noted " + noted.join();
    noted.length = 0;
    if (answers.indexOf(answer) < 0)
      answers.push(answer);
  }
  lines.push(name + ": " + answers.join(" | "));
}

function accessor(name) {
  return {
    get: function () { return name; },
    set: function (value) { noted.push(name + "=" + value); },
    configurable: true,
  };
}

function notingProxy(target) {
  return new Proxy(target, {
    set: function (target, key, value, receiver) {
      noted.push("trap " + String(key));
      return Reflect.set(target, key, value, receiver);
    },
  });
}

// What a change returns is its second step.
var changes = {
  replacePrototypeObject: function (Made) {
    var original = Made.prototype;
    Made.prototype = Object.defineProperty({ tag: "replacement" }, "b", accessor("replacement"));
    return function () { Made.prototype = original; };
  },
  replacePrototypeObjectByNumber: function (Made) {
    var original = Made.prototype;
    Made.prototype = 1;
    return function () { Made.prototype = original; };
  },
  relinkParent: function (Made, Base) {
    Object.setPrototypeOf(Base.prototype, Object.defineProperty({ tag: "above" }, "b", accessor("above")));
    return function () { Object.setPrototypeOf(Base.prototype, Object.prototype); };
  },
  plantSetterOnParent: function (Made, Base) {
    Object.defineProperty(Base.prototype, "b", accessor("parent"));
    return function () { delete Base.prototype.b; };
  },
  plantReadOnlyOnParent: function (Made, Base) {
    Object.defineProperty(Base.prototype, "b", { value: "fixed", writable: false, configurable: true });
    return function () { delete Base.prototype.b; };
  },
  plantGetterOnParent: function (Made, Base) {
    Object.defineProperty(Base.prototype, "b", { get: function () { return "got"; }, configurable: true });
    return function () { delete Base.prototype.b; };
  },
  freezeParent: function (Made, Base) {
    Object.freeze(Base.prototype);
  },
  putProxyBetween: function (Made, Base) {
    Object.setPrototypeOf(Made.prototype, notingProxy(Base.prototype));
    return function () { Object.setPrototypeOf(Made.prototype, Base.prototype); };
  },
  putProxyAboveParent: function (Made, Base) {
    Object.setPrototypeOf(Base.prototype, notingProxy({ tag: "target" }));
    return function () { Object.setPrototypeOf(Base.prototype, Object.prototype); };
  },
  relinkToOtherParent: function (Made, Base) {
    function Other() {}
    Other.prototype.tag = "Other";
    Other.prototype.who = function () { return "Other " + this.a; };
    Object.defineProperty(Other.prototype, "b", accessor("other"));
    inherits(Made, Other);
    return function () { inherits(Made, Base); };
  },
  relinkToNull: function (Made, Base) {
    Object.setPrototypeOf(Made.prototype, null);
    return function () { Object.setPrototypeOf(Made.prototype, Base.prototype); };
  },
  plantSetterOnOwnPrototype: function (Made) {
    Object.defineProperty(Made.prototype, "b", accessor("own"));
    return function () { delete Made.prototype.b; };
  },
  // The objects go on to inherit from the prototype object that the parent had at first.
  replacePrototypeOfParent: function (Made, Base) {
    var original = Base.prototype;
    Base.prototype = Object.defineProperty({ tag: "new parent" }, "b", accessor("new parent"));
    new Base();
    return function () { Object.defineProperty(original, "b", accessor("first parent")); };
  },
  plantSetterAboveParent: function (Made, Base) {
    var above = Object.create(Object.getPrototypeOf(Base.prototype));
    Object.setPrototypeOf(Base.prototype, above);
    construct("  with an empty object above the parent", function () { return new Made(0); });
    Object.defineProperty(above, "b", accessor("late"));
    return function () { delete above.b; };
  },
  hideMethodOnOwnPrototype: function (Made) {
    Made.prototype.who = function () { return "nearer " + this.a; };
    return function () { delete Made.prototype.who; };
  },
  replaceMethodOnParent: function (Made, Base) {
    Base.prototype.who = function () { return "replaced " + this.a; };
    return function () { delete Base.prototype.who; };
  },
  answerInstanceofOtherwise: function (Made, Base) {
    Object.defineProperty(Base, Symbol.hasInstance, { value: function () { return false; }, configurable: true });
    return function () { delete Base[Symbol.hasInstance]; };
  },
};

function run(change, form, Made, Base, make, probe, changesFirst) {
  var name = change + (changesFirst ? " first, " : " later, ") + form;
  Made = unseen(Made);
  Base = unseen(Base);
  if (!changesFirst)
    construct(name + ", untouched", make, 1, probe);
  var secondStep = changes[change](Made, Base);
  construct(name + ", changed", make, 2, probe);
  if (secondStep) {
    secondStep();
    construct(name + ", changed again", make, 3, probe);
  }
}

function Base1() {}
Base1.prototype.tag = "Base1";
Base1.prototype.c = 0;
Base1.prototype.who = function () { return "Base1 " + this.a; };
function Made1(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Object.setPrototypeOf(Made1.prototype, Base1.prototype);
Made1.prototype.tag = "Made1";
function make1(x) { return new Made1(x); }
function probe1(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base1) + " " + (made instanceof Made1); }
run("replacePrototypeObject", "setPrototypeOf", Made1, Base1, make1, probe1, false);

function Base2() {}
Base2.prototype.tag = "Base2";
Base2.prototype.c = 0;
Base2.prototype.who = function () { return "Base2 " + this.a; };
function Made2(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made2.prototype = Object.create(Base2.prototype);
Made2.prototype.tag = "Made2";
function make2(x) { return new Made2(x); }
function probe2(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base2) + " " + (made instanceof Made2); }
run("replacePrototypeObject", "create", Made2, Base2, make2, probe2, false);

function Base3() {}
Base3.prototype.tag = "Base3";
Base3.prototype.c = 0;
Base3.prototype.who = function () { return "Base3 " + this.a; };
function Made3(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made3.prototype = new Base3();
Made3.prototype.tag = "Made3";
function make3(x) { return new Made3(x); }
function probe3(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base3) + " " + (made instanceof Made3); }
run("replacePrototypeObject", "instance", Made3, Base3, make3, probe3, false);

function Base4() {}
Base4.prototype.tag = "Base4";
Base4.prototype.c = 0;
Base4.prototype.who = function () { return "Base4 " + this.a; };
function Made4(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made4.prototype.__proto__ = Base4.prototype;
Made4.prototype.tag = "Made4";
function make4(x) { return new Made4(x); }
function probe4(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base4) + " " + (made instanceof Made4); }
run("replacePrototypeObject", "protoAccessor", Made4, Base4, make4, probe4, true);

function Base5() {}
Base5.prototype.tag = "Base5";
Base5.prototype.c = 0;
Base5.prototype.who = function () { return "Base5 " + this.a; };
function Made5(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made5.prototype = { __proto__: Base5.prototype, constructor: Made5 };
Made5.prototype.tag = "Made5";
function make5(x) { return new Made5(x); }
function probe5(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base5) + " " + (made instanceof Made5); }
run("replacePrototypeObject", "literal", Made5, Base5, make5, probe5, true);

function Base6() {}
Base6.prototype.tag = "Base6";
Base6.prototype.c = 0;
Base6.prototype.who = function () { return "Base6 " + this.a; };
function Made6(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made6.prototype = new Base6();
Made6.prototype.tag = "Made6";
function make6(x) { return new Made6(x); }
function probe6(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base6) + " " + (made instanceof Made6); }
run("replacePrototypeObject", "instance", Made6, Base6, make6, probe6, true);

function Base7() {}
Base7.prototype.tag = "Base7";
Base7.prototype.c = 0;
Base7.prototype.who = function () { return "Base7 " + this.a; };
function Made7(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made7.prototype.__proto__ = Base7.prototype;
Made7.prototype.tag = "Made7";
function make7(x) { return new Made7(x); }
function probe7(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base7) + " " + (made instanceof Made7); }
run("replacePrototypeObjectByNumber", "protoAccessor", Made7, Base7, make7, probe7, false);

function Base8() {}
Base8.prototype.tag = "Base8";
Base8.prototype.c = 0;
Base8.prototype.who = function () { return "Base8 " + this.a; };
function Made8(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made8.prototype = { __proto__: Base8.prototype, constructor: Made8 };
Made8.prototype.tag = "Made8";
function make8(x) { return new Made8(x); }
function probe8(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base8) + " " + (made instanceof Made8); }
run("replacePrototypeObjectByNumber", "literal", Made8, Base8, make8, probe8, false);

function Base9() {}
Base9.prototype.tag = "Base9";
Base9.prototype.c = 0;
Base9.prototype.who = function () { return "Base9 " + this.a; };
function Made9(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made9.prototype = new Base9();
Made9.prototype.tag = "Made9";
function make9(x) { return new Made9(x); }
function probe9(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base9) + " " + (made instanceof Made9); }
run("replacePrototypeObjectByNumber", "instance", Made9, Base9, make9, probe9, false);

function Base10() {}
Base10.prototype.tag = "Base10";
Base10.prototype.c = 0;
Base10.prototype.who = function () { return "Base10 " + this.a; };
function Made10(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
inherits(Made10, Base10);
Made10.prototype.tag = "Made10";
function make10(x) { return new Made10(x); }
function probe10(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base10) + " " + (made instanceof Made10); }
run("replacePrototypeObjectByNumber", "inherits", Made10, Base10, make10, probe10, true);

function Base11() {}
Base11.prototype.tag = "Base11";
Base11.prototype.c = 0;
Base11.prototype.who = function () { return "Base11 " + this.a; };
function Made11(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made11.prototype = Object.assign(Object.create(Base11.prototype), { constructor: Made11 });
Made11.prototype.tag = "Made11";
function make11(x) { return new Made11(x); }
function probe11(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base11) + " " + (made instanceof Made11); }
run("replacePrototypeObjectByNumber", "assign", Made11, Base11, make11, probe11, true);

function Base12() {}
Base12.prototype.tag = "Base12";
Base12.prototype.c = 0;
Base12.prototype.who = function () { return "Base12 " + this.a; };
function Made12(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made12.prototype = new Base12();
Made12.prototype.tag = "Made12";
function make12(x) { return new Made12(x); }
function probe12(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base12) + " " + (made instanceof Made12); }
run("replacePrototypeObjectByNumber", "instance", Made12, Base12, make12, probe12, true);

function Base13() {}
Base13.prototype.tag = "Base13";
Base13.prototype.c = 0;
Base13.prototype.who = function () { return "Base13 " + this.a; };
function Made13(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
inherits(Made13, Base13);
Made13.prototype.tag = "Made13";
function make13(x) { return new Made13(x); }
function probe13(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base13) + " " + (made instanceof Made13); }
run("relinkParent", "inherits", Made13, Base13, make13, probe13, false);

function Base14() {}
Base14.prototype.tag = "Base14";
Base14.prototype.c = 0;
Base14.prototype.who = function () { return "Base14 " + this.a; };
function Made14(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made14.prototype = Object.assign(Object.create(Base14.prototype), { constructor: Made14 });
Made14.prototype.tag = "Made14";
function make14(x) { return new Made14(x); }
function probe14(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base14) + " " + (made instanceof Made14); }
run("relinkParent", "assign", Made14, Base14, make14, probe14, false);

function Base15() {}
Base15.prototype.tag = "Base15";
Base15.prototype.c = 0;
Base15.prototype.who = function () { return "Base15 " + this.a; };
function Made15(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made15.prototype = new Base15();
Made15.prototype.tag = "Made15";
function make15(x) { return new Made15(x); }
function probe15(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base15) + " " + (made instanceof Made15); }
run("relinkParent", "instance", Made15, Base15, make15, probe15, false);

function Base16() {}
Base16.prototype.tag = "Base16";
Base16.prototype.c = 0;
Base16.prototype.who = function () { return "Base16 " + this.a; };
function Made16(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Reflect.setPrototypeOf(Made16.prototype, Base16.prototype);
Made16.prototype.tag = "Made16";
function make16(x) { return new Made16(x); }
function probe16(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base16) + " " + (made instanceof Made16); }
run("relinkParent", "reflect", Made16, Base16, make16, probe16, true);

function Base17() {}
Base17.prototype.tag = "Base17";
Base17.prototype.c = 0;
Base17.prototype.who = function () { return "Base17 " + this.a; };
function Made17(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made17.prototype = Object.create(Base17.prototype, { constructor: { value: Made17, writable: true, configurable: true } });
Made17.prototype.tag = "Made17";
function make17(x) { return new Made17(x); }
function probe17(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base17) + " " + (made instanceof Made17); }
run("relinkParent", "descriptors", Made17, Base17, make17, probe17, true);

function Base18() {}
Base18.prototype.tag = "Base18";
Base18.prototype.c = 0;
Base18.prototype.who = function () { return "Base18 " + this.a; };
function Made18(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made18.prototype = new Base18();
Made18.prototype.tag = "Made18";
function make18(x) { return new Made18(x); }
function probe18(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base18) + " " + (made instanceof Made18); }
run("relinkParent", "instance", Made18, Base18, make18, probe18, true);

function Base19() {}
Base19.prototype.tag = "Base19";
Base19.prototype.c = 0;
Base19.prototype.who = function () { return "Base19 " + this.a; };
function Made19(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Reflect.setPrototypeOf(Made19.prototype, Base19.prototype);
Made19.prototype.tag = "Made19";
function make19(x) { return new Made19(x); }
function probe19(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base19) + " " + (made instanceof Made19); }
run("plantSetterOnParent", "reflect", Made19, Base19, make19, probe19, false);

function Base20() {}
Base20.prototype.tag = "Base20";
Base20.prototype.c = 0;
Base20.prototype.who = function () { return "Base20 " + this.a; };
function Made20(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made20.prototype = Object.create(Base20.prototype, { constructor: { value: Made20, writable: true, configurable: true } });
Made20.prototype.tag = "Made20";
function make20(x) { return new Made20(x); }
function probe20(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base20) + " " + (made instanceof Made20); }
run("plantSetterOnParent", "descriptors", Made20, Base20, make20, probe20, false);

function Base21() {}
Base21.prototype.tag = "Base21";
Base21.prototype.c = 0;
Base21.prototype.who = function () { return "Base21 " + this.a; };
function Made21(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made21.prototype = new Base21();
Made21.prototype.tag = "Made21";
function make21(x) { return new Made21(x); }
function probe21(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base21) + " " + (made instanceof Made21); }
run("plantSetterOnParent", "instance", Made21, Base21, make21, probe21, false);

function Base22() {}
Base22.prototype.tag = "Base22";
Base22.prototype.c = 0;
Base22.prototype.who = function () { return "Base22 " + this.a; };
function Made22(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Object.setPrototypeOf(Made22.prototype, Base22.prototype);
Made22.prototype.tag = "Made22";
function make22(x) { return new Made22(x); }
function probe22(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base22) + " " + (made instanceof Made22); }
run("plantSetterOnParent", "setPrototypeOf", Made22, Base22, make22, probe22, true);

function Base23() {}
Base23.prototype.tag = "Base23";
Base23.prototype.c = 0;
Base23.prototype.who = function () { return "Base23 " + this.a; };
function Made23(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made23.prototype = Object.setPrototypeOf({ constructor: Made23 }, Base23.prototype);
Made23.prototype.tag = "Made23";
function make23(x) { return new Made23(x); }
function probe23(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base23) + " " + (made instanceof Made23); }
run("plantSetterOnParent", "relinkedLiteral", Made23, Base23, make23, probe23, true);

function Base24() {}
Base24.prototype.tag = "Base24";
Base24.prototype.c = 0;
Base24.prototype.who = function () { return "Base24 " + this.a; };
function Made24(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made24.prototype = new Base24();
Made24.prototype.tag = "Made24";
function make24(x) { return new Made24(x); }
function probe24(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base24) + " " + (made instanceof Made24); }
run("plantSetterOnParent", "instance", Made24, Base24, make24, probe24, true);

function Base25() {}
Base25.prototype.tag = "Base25";
Base25.prototype.c = 0;
Base25.prototype.who = function () { return "Base25 " + this.a; };
function Made25(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Object.setPrototypeOf(Made25.prototype, Base25.prototype);
Made25.prototype.tag = "Made25";
function make25(x) { return new Made25(x); }
function probe25(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base25) + " " + (made instanceof Made25); }
run("plantReadOnlyOnParent", "setPrototypeOf", Made25, Base25, make25, probe25, false);

function Base26() {}
Base26.prototype.tag = "Base26";
Base26.prototype.c = 0;
Base26.prototype.who = function () { return "Base26 " + this.a; };
function Made26(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made26.prototype = Object.setPrototypeOf({ constructor: Made26 }, Base26.prototype);
Made26.prototype.tag = "Made26";
function make26(x) { return new Made26(x); }
function probe26(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base26) + " " + (made instanceof Made26); }
run("plantReadOnlyOnParent", "relinkedLiteral", Made26, Base26, make26, probe26, false);

function Base27() {}
Base27.prototype.tag = "Base27";
Base27.prototype.c = 0;
Base27.prototype.who = function () { return "Base27 " + this.a; };
function Made27(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made27.prototype = new Base27();
Made27.prototype.tag = "Made27";
function make27(x) { return new Made27(x); }
function probe27(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base27) + " " + (made instanceof Made27); }
run("plantReadOnlyOnParent", "instance", Made27, Base27, make27, probe27, false);

function Base28() {}
Base28.prototype.tag = "Base28";
Base28.prototype.c = 0;
Base28.prototype.who = function () { return "Base28 " + this.a; };
function Made28(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
inherits(Made28, Base28);
Made28.prototype.tag = "Made28";
function make28(x) { return new Made28(x); }
function probe28(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base28) + " " + (made instanceof Made28); }
run("plantReadOnlyOnParent", "inherits", Made28, Base28, make28, probe28, true);

function Base29() {}
Base29.prototype.tag = "Base29";
Base29.prototype.c = 0;
Base29.prototype.who = function () { return "Base29 " + this.a; };
function Made29(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made29.prototype = Object.create(Base29.prototype);
Made29.prototype.tag = "Made29";
function make29(x) { return new Made29(x); }
function probe29(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base29) + " " + (made instanceof Made29); }
run("plantReadOnlyOnParent", "create", Made29, Base29, make29, probe29, true);

function Base30() {}
Base30.prototype.tag = "Base30";
Base30.prototype.c = 0;
Base30.prototype.who = function () { return "Base30 " + this.a; };
function Made30(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made30.prototype = new Base30();
Made30.prototype.tag = "Made30";
function make30(x) { return new Made30(x); }
function probe30(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base30) + " " + (made instanceof Made30); }
run("plantReadOnlyOnParent", "instance", Made30, Base30, make30, probe30, true);

function Base31() {}
Base31.prototype.tag = "Base31";
Base31.prototype.c = 0;
Base31.prototype.who = function () { return "Base31 " + this.a; };
function Made31(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made31.prototype.__proto__ = Base31.prototype;
Made31.prototype.tag = "Made31";
function make31(x) { return new Made31(x); }
function probe31(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base31) + " " + (made instanceof Made31); }
run("plantGetterOnParent", "protoAccessor", Made31, Base31, make31, probe31, false);

function Base32() {}
Base32.prototype.tag = "Base32";
Base32.prototype.c = 0;
Base32.prototype.who = function () { return "Base32 " + this.a; };
function Made32(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made32.prototype = Object.create(Base32.prototype);
Made32.prototype.tag = "Made32";
function make32(x) { return new Made32(x); }
function probe32(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base32) + " " + (made instanceof Made32); }
run("plantGetterOnParent", "create", Made32, Base32, make32, probe32, false);

function Base33() {}
Base33.prototype.tag = "Base33";
Base33.prototype.c = 0;
Base33.prototype.who = function () { return "Base33 " + this.a; };
function Made33(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made33.prototype = new Base33();
Made33.prototype.tag = "Made33";
function make33(x) { return new Made33(x); }
function probe33(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base33) + " " + (made instanceof Made33); }
run("plantGetterOnParent", "instance", Made33, Base33, make33, probe33, false);

function Base34() {}
Base34.prototype.tag = "Base34";
Base34.prototype.c = 0;
Base34.prototype.who = function () { return "Base34 " + this.a; };
function Made34(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Reflect.setPrototypeOf(Made34.prototype, Base34.prototype);
Made34.prototype.tag = "Made34";
function make34(x) { return new Made34(x); }
function probe34(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base34) + " " + (made instanceof Made34); }
run("plantGetterOnParent", "reflect", Made34, Base34, make34, probe34, true);

function Base35() {}
Base35.prototype.tag = "Base35";
Base35.prototype.c = 0;
Base35.prototype.who = function () { return "Base35 " + this.a; };
function Made35(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made35.prototype = Object.assign(Object.create(Base35.prototype), { constructor: Made35 });
Made35.prototype.tag = "Made35";
function make35(x) { return new Made35(x); }
function probe35(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base35) + " " + (made instanceof Made35); }
run("plantGetterOnParent", "assign", Made35, Base35, make35, probe35, true);

function Base36() {}
Base36.prototype.tag = "Base36";
Base36.prototype.c = 0;
Base36.prototype.who = function () { return "Base36 " + this.a; };
function Made36(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made36.prototype = new Base36();
Made36.prototype.tag = "Made36";
function make36(x) { return new Made36(x); }
function probe36(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base36) + " " + (made instanceof Made36); }
run("plantGetterOnParent", "instance", Made36, Base36, make36, probe36, true);

function Base37() {}
Base37.prototype.tag = "Base37";
Base37.prototype.c = 0;
Base37.prototype.who = function () { return "Base37 " + this.a; };
function Made37(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
inherits(Made37, Base37);
Made37.prototype.tag = "Made37";
function make37(x) { return new Made37(x); }
function probe37(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base37) + " " + (made instanceof Made37); }
run("freezeParent", "inherits", Made37, Base37, make37, probe37, false);

function Base38() {}
Base38.prototype.tag = "Base38";
Base38.prototype.c = 0;
Base38.prototype.who = function () { return "Base38 " + this.a; };
function Made38(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made38.prototype = { __proto__: Base38.prototype, constructor: Made38 };
Made38.prototype.tag = "Made38";
function make38(x) { return new Made38(x); }
function probe38(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base38) + " " + (made instanceof Made38); }
run("freezeParent", "literal", Made38, Base38, make38, probe38, false);

function Base39() {}
Base39.prototype.tag = "Base39";
Base39.prototype.c = 0;
Base39.prototype.who = function () { return "Base39 " + this.a; };
function Made39(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made39.prototype = new Base39();
Made39.prototype.tag = "Made39";
function make39(x) { return new Made39(x); }
function probe39(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base39) + " " + (made instanceof Made39); }
run("freezeParent", "instance", Made39, Base39, make39, probe39, false);

function Base40() {}
Base40.prototype.tag = "Base40";
Base40.prototype.c = 0;
Base40.prototype.who = function () { return "Base40 " + this.a; };
function Made40(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Object.setPrototypeOf(Made40.prototype, Base40.prototype);
Made40.prototype.tag = "Made40";
function make40(x) { return new Made40(x); }
function probe40(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base40) + " " + (made instanceof Made40); }
run("freezeParent", "setPrototypeOf", Made40, Base40, make40, probe40, true);

function Base41() {}
Base41.prototype.tag = "Base41";
Base41.prototype.c = 0;
Base41.prototype.who = function () { return "Base41 " + this.a; };
function Made41(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made41.prototype = Object.create(Base41.prototype, { constructor: { value: Made41, writable: true, configurable: true } });
Made41.prototype.tag = "Made41";
function make41(x) { return new Made41(x); }
function probe41(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base41) + " " + (made instanceof Made41); }
run("freezeParent", "descriptors", Made41, Base41, make41, probe41, true);

function Base42() {}
Base42.prototype.tag = "Base42";
Base42.prototype.c = 0;
Base42.prototype.who = function () { return "Base42 " + this.a; };
function Made42(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made42.prototype = new Base42();
Made42.prototype.tag = "Made42";
function make42(x) { return new Made42(x); }
function probe42(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base42) + " " + (made instanceof Made42); }
run("freezeParent", "instance", Made42, Base42, make42, probe42, true);

function Base43() {}
Base43.prototype.tag = "Base43";
Base43.prototype.c = 0;
Base43.prototype.who = function () { return "Base43 " + this.a; };
function Made43(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Reflect.setPrototypeOf(Made43.prototype, Base43.prototype);
Made43.prototype.tag = "Made43";
function make43(x) { return new Made43(x); }
function probe43(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base43) + " " + (made instanceof Made43); }
run("putProxyBetween", "reflect", Made43, Base43, make43, probe43, false);

function Base44() {}
Base44.prototype.tag = "Base44";
Base44.prototype.c = 0;
Base44.prototype.who = function () { return "Base44 " + this.a; };
function Made44(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made44.prototype = Object.assign(Object.create(Base44.prototype), { constructor: Made44 });
Made44.prototype.tag = "Made44";
function make44(x) { return new Made44(x); }
function probe44(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base44) + " " + (made instanceof Made44); }
run("putProxyBetween", "assign", Made44, Base44, make44, probe44, false);

function Base45() {}
Base45.prototype.tag = "Base45";
Base45.prototype.c = 0;
Base45.prototype.who = function () { return "Base45 " + this.a; };
function Made45(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made45.prototype = new Base45();
Made45.prototype.tag = "Made45";
function make45(x) { return new Made45(x); }
function probe45(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base45) + " " + (made instanceof Made45); }
run("putProxyBetween", "instance", Made45, Base45, make45, probe45, false);

function Base46() {}
Base46.prototype.tag = "Base46";
Base46.prototype.c = 0;
Base46.prototype.who = function () { return "Base46 " + this.a; };
function Made46(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made46.prototype.__proto__ = Base46.prototype;
Made46.prototype.tag = "Made46";
function make46(x) { return new Made46(x); }
function probe46(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base46) + " " + (made instanceof Made46); }
run("putProxyBetween", "protoAccessor", Made46, Base46, make46, probe46, true);

function Base47() {}
Base47.prototype.tag = "Base47";
Base47.prototype.c = 0;
Base47.prototype.who = function () { return "Base47 " + this.a; };
function Made47(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made47.prototype = Object.setPrototypeOf({ constructor: Made47 }, Base47.prototype);
Made47.prototype.tag = "Made47";
function make47(x) { return new Made47(x); }
function probe47(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base47) + " " + (made instanceof Made47); }
run("putProxyBetween", "relinkedLiteral", Made47, Base47, make47, probe47, true);

function Base48() {}
Base48.prototype.tag = "Base48";
Base48.prototype.c = 0;
Base48.prototype.who = function () { return "Base48 " + this.a; };
function Made48(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made48.prototype = new Base48();
Made48.prototype.tag = "Made48";
function make48(x) { return new Made48(x); }
function probe48(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base48) + " " + (made instanceof Made48); }
run("putProxyBetween", "instance", Made48, Base48, make48, probe48, true);

function Base49() {}
Base49.prototype.tag = "Base49";
Base49.prototype.c = 0;
Base49.prototype.who = function () { return "Base49 " + this.a; };
function Made49(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Object.setPrototypeOf(Made49.prototype, Base49.prototype);
Made49.prototype.tag = "Made49";
function make49(x) { return new Made49(x); }
function probe49(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base49) + " " + (made instanceof Made49); }
run("putProxyAboveParent", "setPrototypeOf", Made49, Base49, make49, probe49, false);

function Base50() {}
Base50.prototype.tag = "Base50";
Base50.prototype.c = 0;
Base50.prototype.who = function () { return "Base50 " + this.a; };
function Made50(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made50.prototype = Object.create(Base50.prototype, { constructor: { value: Made50, writable: true, configurable: true } });
Made50.prototype.tag = "Made50";
function make50(x) { return new Made50(x); }
function probe50(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base50) + " " + (made instanceof Made50); }
run("putProxyAboveParent", "descriptors", Made50, Base50, make50, probe50, false);

function Base51() {}
Base51.prototype.tag = "Base51";
Base51.prototype.c = 0;
Base51.prototype.who = function () { return "Base51 " + this.a; };
function Made51(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made51.prototype = new Base51();
Made51.prototype.tag = "Made51";
function make51(x) { return new Made51(x); }
function probe51(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base51) + " " + (made instanceof Made51); }
run("putProxyAboveParent", "instance", Made51, Base51, make51, probe51, false);

function Base52() {}
Base52.prototype.tag = "Base52";
Base52.prototype.c = 0;
Base52.prototype.who = function () { return "Base52 " + this.a; };
function Made52(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Reflect.setPrototypeOf(Made52.prototype, Base52.prototype);
Made52.prototype.tag = "Made52";
function make52(x) { return new Made52(x); }
function probe52(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base52) + " " + (made instanceof Made52); }
run("putProxyAboveParent", "reflect", Made52, Base52, make52, probe52, true);

function Base53() {}
Base53.prototype.tag = "Base53";
Base53.prototype.c = 0;
Base53.prototype.who = function () { return "Base53 " + this.a; };
function Made53(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made53.prototype = Object.create(Base53.prototype);
Made53.prototype.tag = "Made53";
function make53(x) { return new Made53(x); }
function probe53(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base53) + " " + (made instanceof Made53); }
run("putProxyAboveParent", "create", Made53, Base53, make53, probe53, true);

function Base54() {}
Base54.prototype.tag = "Base54";
Base54.prototype.c = 0;
Base54.prototype.who = function () { return "Base54 " + this.a; };
function Made54(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made54.prototype = new Base54();
Made54.prototype.tag = "Made54";
function make54(x) { return new Made54(x); }
function probe54(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base54) + " " + (made instanceof Made54); }
run("putProxyAboveParent", "instance", Made54, Base54, make54, probe54, true);

function Base55() {}
Base55.prototype.tag = "Base55";
Base55.prototype.c = 0;
Base55.prototype.who = function () { return "Base55 " + this.a; };
function Made55(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made55.prototype.__proto__ = Base55.prototype;
Made55.prototype.tag = "Made55";
function make55(x) { return new Made55(x); }
function probe55(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base55) + " " + (made instanceof Made55); }
run("relinkToOtherParent", "protoAccessor", Made55, Base55, make55, probe55, false);

function Base56() {}
Base56.prototype.tag = "Base56";
Base56.prototype.c = 0;
Base56.prototype.who = function () { return "Base56 " + this.a; };
function Made56(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made56.prototype = Object.setPrototypeOf({ constructor: Made56 }, Base56.prototype);
Made56.prototype.tag = "Made56";
function make56(x) { return new Made56(x); }
function probe56(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base56) + " " + (made instanceof Made56); }
run("relinkToOtherParent", "relinkedLiteral", Made56, Base56, make56, probe56, false);

function Base57() {}
Base57.prototype.tag = "Base57";
Base57.prototype.c = 0;
Base57.prototype.who = function () { return "Base57 " + this.a; };
function Made57(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made57.prototype = new Base57();
Made57.prototype.tag = "Made57";
function make57(x) { return new Made57(x); }
function probe57(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base57) + " " + (made instanceof Made57); }
run("relinkToOtherParent", "instance", Made57, Base57, make57, probe57, false);

function Base58() {}
Base58.prototype.tag = "Base58";
Base58.prototype.c = 0;
Base58.prototype.who = function () { return "Base58 " + this.a; };
function Made58(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Object.setPrototypeOf(Made58.prototype, Base58.prototype);
Made58.prototype.tag = "Made58";
function make58(x) { return new Made58(x); }
function probe58(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base58) + " " + (made instanceof Made58); }
run("relinkToOtherParent", "setPrototypeOf", Made58, Base58, make58, probe58, true);

function Base59() {}
Base59.prototype.tag = "Base59";
Base59.prototype.c = 0;
Base59.prototype.who = function () { return "Base59 " + this.a; };
function Made59(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made59.prototype = { __proto__: Base59.prototype, constructor: Made59 };
Made59.prototype.tag = "Made59";
function make59(x) { return new Made59(x); }
function probe59(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base59) + " " + (made instanceof Made59); }
run("relinkToOtherParent", "literal", Made59, Base59, make59, probe59, true);

function Base60() {}
Base60.prototype.tag = "Base60";
Base60.prototype.c = 0;
Base60.prototype.who = function () { return "Base60 " + this.a; };
function Made60(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made60.prototype = new Base60();
Made60.prototype.tag = "Made60";
function make60(x) { return new Made60(x); }
function probe60(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base60) + " " + (made instanceof Made60); }
run("relinkToOtherParent", "instance", Made60, Base60, make60, probe60, true);

function Base61() {}
Base61.prototype.tag = "Base61";
Base61.prototype.c = 0;
Base61.prototype.who = function () { return "Base61 " + this.a; };
function Made61(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
inherits(Made61, Base61);
Made61.prototype.tag = "Made61";
function make61(x) { return new Made61(x); }
function probe61(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base61) + " " + (made instanceof Made61); }
run("relinkToNull", "inherits", Made61, Base61, make61, probe61, false);

function Base62() {}
Base62.prototype.tag = "Base62";
Base62.prototype.c = 0;
Base62.prototype.who = function () { return "Base62 " + this.a; };
function Made62(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made62.prototype = Object.create(Base62.prototype);
Made62.prototype.tag = "Made62";
function make62(x) { return new Made62(x); }
function probe62(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base62) + " " + (made instanceof Made62); }
run("relinkToNull", "create", Made62, Base62, make62, probe62, false);

function Base63() {}
Base63.prototype.tag = "Base63";
Base63.prototype.c = 0;
Base63.prototype.who = function () { return "Base63 " + this.a; };
function Made63(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made63.prototype = new Base63();
Made63.prototype.tag = "Made63";
function make63(x) { return new Made63(x); }
function probe63(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base63) + " " + (made instanceof Made63); }
run("relinkToNull", "instance", Made63, Base63, make63, probe63, false);

function Base64() {}
Base64.prototype.tag = "Base64";
Base64.prototype.c = 0;
Base64.prototype.who = function () { return "Base64 " + this.a; };
function Made64(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made64.prototype.__proto__ = Base64.prototype;
Made64.prototype.tag = "Made64";
function make64(x) { return new Made64(x); }
function probe64(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base64) + " " + (made instanceof Made64); }
run("relinkToNull", "protoAccessor", Made64, Base64, make64, probe64, true);

function Base65() {}
Base65.prototype.tag = "Base65";
Base65.prototype.c = 0;
Base65.prototype.who = function () { return "Base65 " + this.a; };
function Made65(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made65.prototype = Object.create(Base65.prototype, { constructor: { value: Made65, writable: true, configurable: true } });
Made65.prototype.tag = "Made65";
function make65(x) { return new Made65(x); }
function probe65(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base65) + " " + (made instanceof Made65); }
run("relinkToNull", "descriptors", Made65, Base65, make65, probe65, true);

function Base66() {}
Base66.prototype.tag = "Base66";
Base66.prototype.c = 0;
Base66.prototype.who = function () { return "Base66 " + this.a; };
function Made66(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made66.prototype = new Base66();
Made66.prototype.tag = "Made66";
function make66(x) { return new Made66(x); }
function probe66(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base66) + " " + (made instanceof Made66); }
run("relinkToNull", "instance", Made66, Base66, make66, probe66, true);

function Base67() {}
Base67.prototype.tag = "Base67";
Base67.prototype.c = 0;
Base67.prototype.who = function () { return "Base67 " + this.a; };
function Made67(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Reflect.setPrototypeOf(Made67.prototype, Base67.prototype);
Made67.prototype.tag = "Made67";
function make67(x) { return new Made67(x); }
function probe67(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base67) + " " + (made instanceof Made67); }
run("plantSetterOnOwnPrototype", "reflect", Made67, Base67, make67, probe67, false);

function Base68() {}
Base68.prototype.tag = "Base68";
Base68.prototype.c = 0;
Base68.prototype.who = function () { return "Base68 " + this.a; };
function Made68(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made68.prototype = { __proto__: Base68.prototype, constructor: Made68 };
Made68.prototype.tag = "Made68";
function make68(x) { return new Made68(x); }
function probe68(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base68) + " " + (made instanceof Made68); }
run("plantSetterOnOwnPrototype", "literal", Made68, Base68, make68, probe68, false);

function Base69() {}
Base69.prototype.tag = "Base69";
Base69.prototype.c = 0;
Base69.prototype.who = function () { return "Base69 " + this.a; };
function Made69(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made69.prototype = new Base69();
Made69.prototype.tag = "Made69";
function make69(x) { return new Made69(x); }
function probe69(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base69) + " " + (made instanceof Made69); }
run("plantSetterOnOwnPrototype", "instance", Made69, Base69, make69, probe69, false);

function Base70() {}
Base70.prototype.tag = "Base70";
Base70.prototype.c = 0;
Base70.prototype.who = function () { return "Base70 " + this.a; };
function Made70(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
inherits(Made70, Base70);
Made70.prototype.tag = "Made70";
function make70(x) { return new Made70(x); }
function probe70(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base70) + " " + (made instanceof Made70); }
run("plantSetterOnOwnPrototype", "inherits", Made70, Base70, make70, probe70, true);

function Base71() {}
Base71.prototype.tag = "Base71";
Base71.prototype.c = 0;
Base71.prototype.who = function () { return "Base71 " + this.a; };
function Made71(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made71.prototype = Object.setPrototypeOf({ constructor: Made71 }, Base71.prototype);
Made71.prototype.tag = "Made71";
function make71(x) { return new Made71(x); }
function probe71(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base71) + " " + (made instanceof Made71); }
run("plantSetterOnOwnPrototype", "relinkedLiteral", Made71, Base71, make71, probe71, true);

function Base72() {}
Base72.prototype.tag = "Base72";
Base72.prototype.c = 0;
Base72.prototype.who = function () { return "Base72 " + this.a; };
function Made72(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made72.prototype = new Base72();
Made72.prototype.tag = "Made72";
function make72(x) { return new Made72(x); }
function probe72(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base72) + " " + (made instanceof Made72); }
run("plantSetterOnOwnPrototype", "instance", Made72, Base72, make72, probe72, true);

function Base73() {}
Base73.prototype.tag = "Base73";
Base73.prototype.c = 0;
Base73.prototype.who = function () { return "Base73 " + this.a; };
function Made73(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Object.setPrototypeOf(Made73.prototype, Base73.prototype);
Made73.prototype.tag = "Made73";
function make73(x) { return new Made73(x); }
function probe73(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base73) + " " + (made instanceof Made73); }
run("replacePrototypeOfParent", "setPrototypeOf", Made73, Base73, make73, probe73, false);

function Base74() {}
Base74.prototype.tag = "Base74";
Base74.prototype.c = 0;
Base74.prototype.who = function () { return "Base74 " + this.a; };
function Made74(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made74.prototype = Object.assign(Object.create(Base74.prototype), { constructor: Made74 });
Made74.prototype.tag = "Made74";
function make74(x) { return new Made74(x); }
function probe74(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base74) + " " + (made instanceof Made74); }
run("replacePrototypeOfParent", "assign", Made74, Base74, make74, probe74, false);

function Base75() {}
Base75.prototype.tag = "Base75";
Base75.prototype.c = 0;
Base75.prototype.who = function () { return "Base75 " + this.a; };
function Made75(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made75.prototype = new Base75();
Made75.prototype.tag = "Made75";
function make75(x) { return new Made75(x); }
function probe75(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base75) + " " + (made instanceof Made75); }
run("replacePrototypeOfParent", "instance", Made75, Base75, make75, probe75, false);

function Base76() {}
Base76.prototype.tag = "Base76";
Base76.prototype.c = 0;
Base76.prototype.who = function () { return "Base76 " + this.a; };
function Made76(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Object.setPrototypeOf(Made76.prototype, Base76.prototype);
Made76.prototype.tag = "Made76";
function make76(x) { return new Made76(x); }
function probe76(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base76) + " " + (made instanceof Made76); }
run("replacePrototypeOfParent", "setPrototypeOf", Made76, Base76, make76, probe76, true);

function Base77() {}
Base77.prototype.tag = "Base77";
Base77.prototype.c = 0;
Base77.prototype.who = function () { return "Base77 " + this.a; };
function Made77(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made77.prototype = Object.create(Base77.prototype);
Made77.prototype.tag = "Made77";
function make77(x) { return new Made77(x); }
function probe77(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base77) + " " + (made instanceof Made77); }
run("replacePrototypeOfParent", "create", Made77, Base77, make77, probe77, true);

function Base78() {}
Base78.prototype.tag = "Base78";
Base78.prototype.c = 0;
Base78.prototype.who = function () { return "Base78 " + this.a; };
function Made78(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made78.prototype = new Base78();
Made78.prototype.tag = "Made78";
function make78(x) { return new Made78(x); }
function probe78(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base78) + " " + (made instanceof Made78); }
run("replacePrototypeOfParent", "instance", Made78, Base78, make78, probe78, true);

function Base79() {}
Base79.prototype.tag = "Base79";
Base79.prototype.c = 0;
Base79.prototype.who = function () { return "Base79 " + this.a; };
function Made79(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made79.prototype.__proto__ = Base79.prototype;
Made79.prototype.tag = "Made79";
function make79(x) { return new Made79(x); }
function probe79(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base79) + " " + (made instanceof Made79); }
run("plantSetterAboveParent", "protoAccessor", Made79, Base79, make79, probe79, false);

function Base80() {}
Base80.prototype.tag = "Base80";
Base80.prototype.c = 0;
Base80.prototype.who = function () { return "Base80 " + this.a; };
function Made80(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made80.prototype = Object.create(Base80.prototype, { constructor: { value: Made80, writable: true, configurable: true } });
Made80.prototype.tag = "Made80";
function make80(x) { return new Made80(x); }
function probe80(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base80) + " " + (made instanceof Made80); }
run("plantSetterAboveParent", "descriptors", Made80, Base80, make80, probe80, false);

function Base81() {}
Base81.prototype.tag = "Base81";
Base81.prototype.c = 0;
Base81.prototype.who = function () { return "Base81 " + this.a; };
function Made81(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made81.prototype = new Base81();
Made81.prototype.tag = "Made81";
function make81(x) { return new Made81(x); }
function probe81(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base81) + " " + (made instanceof Made81); }
run("plantSetterAboveParent", "instance", Made81, Base81, make81, probe81, false);

function Base82() {}
Base82.prototype.tag = "Base82";
Base82.prototype.c = 0;
Base82.prototype.who = function () { return "Base82 " + this.a; };
function Made82(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made82.prototype.__proto__ = Base82.prototype;
Made82.prototype.tag = "Made82";
function make82(x) { return new Made82(x); }
function probe82(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base82) + " " + (made instanceof Made82); }
run("plantSetterAboveParent", "protoAccessor", Made82, Base82, make82, probe82, true);

function Base83() {}
Base83.prototype.tag = "Base83";
Base83.prototype.c = 0;
Base83.prototype.who = function () { return "Base83 " + this.a; };
function Made83(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made83.prototype = { __proto__: Base83.prototype, constructor: Made83 };
Made83.prototype.tag = "Made83";
function make83(x) { return new Made83(x); }
function probe83(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base83) + " " + (made instanceof Made83); }
run("plantSetterAboveParent", "literal", Made83, Base83, make83, probe83, true);

function Base84() {}
Base84.prototype.tag = "Base84";
Base84.prototype.c = 0;
Base84.prototype.who = function () { return "Base84 " + this.a; };
function Made84(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made84.prototype = new Base84();
Made84.prototype.tag = "Made84";
function make84(x) { return new Made84(x); }
function probe84(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base84) + " " + (made instanceof Made84); }
run("plantSetterAboveParent", "instance", Made84, Base84, make84, probe84, true);

function Base85() {}
Base85.prototype.tag = "Base85";
Base85.prototype.c = 0;
Base85.prototype.who = function () { return "Base85 " + this.a; };
function Made85(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
inherits(Made85, Base85);
Made85.prototype.tag = "Made85";
function make85(x) { return new Made85(x); }
function probe85(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base85) + " " + (made instanceof Made85); }
run("hideMethodOnOwnPrototype", "inherits", Made85, Base85, make85, probe85, false);

function Base86() {}
Base86.prototype.tag = "Base86";
Base86.prototype.c = 0;
Base86.prototype.who = function () { return "Base86 " + this.a; };
function Made86(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made86.prototype = Object.setPrototypeOf({ constructor: Made86 }, Base86.prototype);
Made86.prototype.tag = "Made86";
function make86(x) { return new Made86(x); }
function probe86(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base86) + " " + (made instanceof Made86); }
run("hideMethodOnOwnPrototype", "relinkedLiteral", Made86, Base86, make86, probe86, false);

function Base87() {}
Base87.prototype.tag = "Base87";
Base87.prototype.c = 0;
Base87.prototype.who = function () { return "Base87 " + this.a; };
function Made87(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made87.prototype = new Base87();
Made87.prototype.tag = "Made87";
function make87(x) { return new Made87(x); }
function probe87(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base87) + " " + (made instanceof Made87); }
run("hideMethodOnOwnPrototype", "instance", Made87, Base87, make87, probe87, false);

function Base88() {}
Base88.prototype.tag = "Base88";
Base88.prototype.c = 0;
Base88.prototype.who = function () { return "Base88 " + this.a; };
function Made88(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
inherits(Made88, Base88);
Made88.prototype.tag = "Made88";
function make88(x) { return new Made88(x); }
function probe88(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base88) + " " + (made instanceof Made88); }
run("hideMethodOnOwnPrototype", "inherits", Made88, Base88, make88, probe88, true);

function Base89() {}
Base89.prototype.tag = "Base89";
Base89.prototype.c = 0;
Base89.prototype.who = function () { return "Base89 " + this.a; };
function Made89(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made89.prototype = Object.assign(Object.create(Base89.prototype), { constructor: Made89 });
Made89.prototype.tag = "Made89";
function make89(x) { return new Made89(x); }
function probe89(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base89) + " " + (made instanceof Made89); }
run("hideMethodOnOwnPrototype", "assign", Made89, Base89, make89, probe89, true);

function Base90() {}
Base90.prototype.tag = "Base90";
Base90.prototype.c = 0;
Base90.prototype.who = function () { return "Base90 " + this.a; };
function Made90(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made90.prototype = new Base90();
Made90.prototype.tag = "Made90";
function make90(x) { return new Made90(x); }
function probe90(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base90) + " " + (made instanceof Made90); }
run("hideMethodOnOwnPrototype", "instance", Made90, Base90, make90, probe90, true);

function Base91() {}
Base91.prototype.tag = "Base91";
Base91.prototype.c = 0;
Base91.prototype.who = function () { return "Base91 " + this.a; };
function Made91(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Reflect.setPrototypeOf(Made91.prototype, Base91.prototype);
Made91.prototype.tag = "Made91";
function make91(x) { return new Made91(x); }
function probe91(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base91) + " " + (made instanceof Made91); }
run("replaceMethodOnParent", "reflect", Made91, Base91, make91, probe91, false);

function Base92() {}
Base92.prototype.tag = "Base92";
Base92.prototype.c = 0;
Base92.prototype.who = function () { return "Base92 " + this.a; };
function Made92(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made92.prototype = Object.create(Base92.prototype);
Made92.prototype.tag = "Made92";
function make92(x) { return new Made92(x); }
function probe92(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base92) + " " + (made instanceof Made92); }
run("replaceMethodOnParent", "create", Made92, Base92, make92, probe92, false);

function Base93() {}
Base93.prototype.tag = "Base93";
Base93.prototype.c = 0;
Base93.prototype.who = function () { return "Base93 " + this.a; };
function Made93(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made93.prototype = new Base93();
Made93.prototype.tag = "Made93";
function make93(x) { return new Made93(x); }
function probe93(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base93) + " " + (made instanceof Made93); }
run("replaceMethodOnParent", "instance", Made93, Base93, make93, probe93, false);

function Base94() {}
Base94.prototype.tag = "Base94";
Base94.prototype.c = 0;
Base94.prototype.who = function () { return "Base94 " + this.a; };
function Made94(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Reflect.setPrototypeOf(Made94.prototype, Base94.prototype);
Made94.prototype.tag = "Made94";
function make94(x) { return new Made94(x); }
function probe94(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base94) + " " + (made instanceof Made94); }
run("replaceMethodOnParent", "reflect", Made94, Base94, make94, probe94, true);

function Base95() {}
Base95.prototype.tag = "Base95";
Base95.prototype.c = 0;
Base95.prototype.who = function () { return "Base95 " + this.a; };
function Made95(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made95.prototype = Object.setPrototypeOf({ constructor: Made95 }, Base95.prototype);
Made95.prototype.tag = "Made95";
function make95(x) { return new Made95(x); }
function probe95(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base95) + " " + (made instanceof Made95); }
run("replaceMethodOnParent", "relinkedLiteral", Made95, Base95, make95, probe95, true);

function Base96() {}
Base96.prototype.tag = "Base96";
Base96.prototype.c = 0;
Base96.prototype.who = function () { return "Base96 " + this.a; };
function Made96(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made96.prototype = new Base96();
Made96.prototype.tag = "Made96";
function make96(x) { return new Made96(x); }
function probe96(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base96) + " " + (made instanceof Made96); }
run("replaceMethodOnParent", "instance", Made96, Base96, make96, probe96, true);

function Base97() {}
Base97.prototype.tag = "Base97";
Base97.prototype.c = 0;
Base97.prototype.who = function () { return "Base97 " + this.a; };
function Made97(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Object.setPrototypeOf(Made97.prototype, Base97.prototype);
Made97.prototype.tag = "Made97";
function make97(x) { return new Made97(x); }
function probe97(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base97) + " " + (made instanceof Made97); }
run("answerInstanceofOtherwise", "setPrototypeOf", Made97, Base97, make97, probe97, false);

function Base98() {}
Base98.prototype.tag = "Base98";
Base98.prototype.c = 0;
Base98.prototype.who = function () { return "Base98 " + this.a; };
function Made98(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made98.prototype = { __proto__: Base98.prototype, constructor: Made98 };
Made98.prototype.tag = "Made98";
function make98(x) { return new Made98(x); }
function probe98(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base98) + " " + (made instanceof Made98); }
run("answerInstanceofOtherwise", "literal", Made98, Base98, make98, probe98, false);

function Base99() {}
Base99.prototype.tag = "Base99";
Base99.prototype.c = 0;
Base99.prototype.who = function () { return "Base99 " + this.a; };
function Made99(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made99.prototype = new Base99();
Made99.prototype.tag = "Made99";
function make99(x) { return new Made99(x); }
function probe99(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base99) + " " + (made instanceof Made99); }
run("answerInstanceofOtherwise", "instance", Made99, Base99, make99, probe99, false);

function Base100() {}
Base100.prototype.tag = "Base100";
Base100.prototype.c = 0;
Base100.prototype.who = function () { return "Base100 " + this.a; };
function Made100(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made100.prototype.__proto__ = Base100.prototype;
Made100.prototype.tag = "Made100";
function make100(x) { return new Made100(x); }
function probe100(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base100) + " " + (made instanceof Made100); }
run("answerInstanceofOtherwise", "protoAccessor", Made100, Base100, make100, probe100, true);

function Base101() {}
Base101.prototype.tag = "Base101";
Base101.prototype.c = 0;
Base101.prototype.who = function () { return "Base101 " + this.a; };
function Made101(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made101.prototype = Object.create(Base101.prototype);
Made101.prototype.tag = "Made101";
function make101(x) { return new Made101(x); }
function probe101(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base101) + " " + (made instanceof Made101); }
run("answerInstanceofOtherwise", "create", Made101, Base101, make101, probe101, true);

function Base102() {}
Base102.prototype.tag = "Base102";
Base102.prototype.c = 0;
Base102.prototype.who = function () { return "Base102 " + this.a; };
function Made102(x) {
  this.a = x;
  this.b = x + 1;
  this.c = x + 2;
}
Made102.prototype = new Base102();
Made102.prototype.tag = "Made102";
function make102(x) { return new Made102(x); }
function probe102(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base102) + " " + (made instanceof Made102); }
run("answerInstanceofOtherwise", "instance", Made102, Base102, make102, probe102, true);

// Each call makes the two functions and their prototype objects again.
var factories = {
  setPrototypeOf: function () {
    function Base() {}
    Base.prototype.tag = "Base";
    Base.prototype.c = 0;
    Base.prototype.who = function () { return "Base " + this.a; };
    function Made(x) {
      this.a = x;
      this.b = x + 1;
      this.c = x + 2;
    }
    Object.setPrototypeOf(Made.prototype, Base.prototype);
    Made.prototype.tag = "Made";
    function make(x) { return new Made(x); }
    function probe(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base) + " " + (made instanceof Made); }
    return { Made: Made, Base: Base, make: make, probe: probe };
  },
  protoAccessor: function () {
    function Base() {}
    Base.prototype.tag = "Base";
    Base.prototype.c = 0;
    Base.prototype.who = function () { return "Base " + this.a; };
    function Made(x) {
      this.a = x;
      this.b = x + 1;
      this.c = x + 2;
    }
    Made.prototype.__proto__ = Base.prototype;
    Made.prototype.tag = "Made";
    function make(x) { return new Made(x); }
    function probe(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base) + " " + (made instanceof Made); }
    return { Made: Made, Base: Base, make: make, probe: probe };
  },
  inherits: function () {
    function Base() {}
    Base.prototype.tag = "Base";
    Base.prototype.c = 0;
    Base.prototype.who = function () { return "Base " + this.a; };
    function Made(x) {
      this.a = x;
      this.b = x + 1;
      this.c = x + 2;
    }
    inherits(Made, Base);
    Made.prototype.tag = "Made";
    function make(x) { return new Made(x); }
    function probe(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base) + " " + (made instanceof Made); }
    return { Made: Made, Base: Base, make: make, probe: probe };
  },
  reflect: function () {
    function Base() {}
    Base.prototype.tag = "Base";
    Base.prototype.c = 0;
    Base.prototype.who = function () { return "Base " + this.a; };
    function Made(x) {
      this.a = x;
      this.b = x + 1;
      this.c = x + 2;
    }
    Reflect.setPrototypeOf(Made.prototype, Base.prototype);
    Made.prototype.tag = "Made";
    function make(x) { return new Made(x); }
    function probe(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base) + " " + (made instanceof Made); }
    return { Made: Made, Base: Base, make: make, probe: probe };
  },
  create: function () {
    function Base() {}
    Base.prototype.tag = "Base";
    Base.prototype.c = 0;
    Base.prototype.who = function () { return "Base " + this.a; };
    function Made(x) {
      this.a = x;
      this.b = x + 1;
      this.c = x + 2;
    }
    Made.prototype = Object.create(Base.prototype);
    Made.prototype.tag = "Made";
    function make(x) { return new Made(x); }
    function probe(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base) + " " + (made instanceof Made); }
    return { Made: Made, Base: Base, make: make, probe: probe };
  },
  literal: function () {
    function Base() {}
    Base.prototype.tag = "Base";
    Base.prototype.c = 0;
    Base.prototype.who = function () { return "Base " + this.a; };
    function Made(x) {
      this.a = x;
      this.b = x + 1;
      this.c = x + 2;
    }
    Made.prototype = { __proto__: Base.prototype, constructor: Made };
    Made.prototype.tag = "Made";
    function make(x) { return new Made(x); }
    function probe(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base) + " " + (made instanceof Made); }
    return { Made: Made, Base: Base, make: make, probe: probe };
  },
  assign: function () {
    function Base() {}
    Base.prototype.tag = "Base";
    Base.prototype.c = 0;
    Base.prototype.who = function () { return "Base " + this.a; };
    function Made(x) {
      this.a = x;
      this.b = x + 1;
      this.c = x + 2;
    }
    Made.prototype = Object.assign(Object.create(Base.prototype), { constructor: Made });
    Made.prototype.tag = "Made";
    function make(x) { return new Made(x); }
    function probe(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base) + " " + (made instanceof Made); }
    return { Made: Made, Base: Base, make: make, probe: probe };
  },
  descriptors: function () {
    function Base() {}
    Base.prototype.tag = "Base";
    Base.prototype.c = 0;
    Base.prototype.who = function () { return "Base " + this.a; };
    function Made(x) {
      this.a = x;
      this.b = x + 1;
      this.c = x + 2;
    }
    Made.prototype = Object.create(Base.prototype, { constructor: { value: Made, writable: true, configurable: true } });
    Made.prototype.tag = "Made";
    function make(x) { return new Made(x); }
    function probe(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base) + " " + (made instanceof Made); }
    return { Made: Made, Base: Base, make: make, probe: probe };
  },
  relinkedLiteral: function () {
    function Base() {}
    Base.prototype.tag = "Base";
    Base.prototype.c = 0;
    Base.prototype.who = function () { return "Base " + this.a; };
    function Made(x) {
      this.a = x;
      this.b = x + 1;
      this.c = x + 2;
    }
    Made.prototype = Object.setPrototypeOf({ constructor: Made }, Base.prototype);
    Made.prototype.tag = "Made";
    function make(x) { return new Made(x); }
    function probe(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base) + " " + (made instanceof Made); }
    return { Made: Made, Base: Base, make: make, probe: probe };
  },
  instance: function () {
    function Base() {}
    Base.prototype.tag = "Base";
    Base.prototype.c = 0;
    Base.prototype.who = function () { return "Base " + this.a; };
    function Made(x) {
      this.a = x;
      this.b = x + 1;
      this.c = x + 2;
    }
    Made.prototype = new Base();
    Made.prototype.tag = "Made";
    function make(x) { return new Made(x); }
    function probe(made) { return (made.who ? made.who() : "nobody") + " " + (made instanceof Base) + " " + (made instanceof Made); }
    return { Made: Made, Base: Base, make: make, probe: probe };
  },
};
Object.keys(factories).forEach(function (form) {
  Object.keys(changes).forEach(function (change) {
    [false, true].forEach(function (changesFirst) {
      var pair = factories[form]();
      run(change, form + " in a function that runs again", pair.Made, pair.Base, pair.make, pair.probe, changesFirst);
    });
  });
});

// The first object is constructed before the link is made.
function LateBase() {}
LateBase.prototype.tag = "LateBase";
Object.defineProperty(LateBase.prototype, "b", accessor("late base"));
function LateMade(x) {
  this.a = x;
  this.b = x + 1;
}
LateMade.prototype.tag = "LateMade";
function makeLate(x) { return new LateMade(x); }
unseen(LateMade);
construct("constructed before the link", makeLate, 1);
Object.setPrototypeOf(LateMade.prototype, LateBase.prototype);
construct("constructed after the link", makeLate, 2);

// The same where the link replaces the prototype object. The first object keeps the one it was made under.
function LateCreatedBase() {}
LateCreatedBase.prototype.tag = "LateCreatedBase";
Object.defineProperty(LateCreatedBase.prototype, "late", accessor("late created base"));
function LateCreated(x) {
  this.a = x;
  this.b = x + 1;
}
LateCreated.prototype.tag = "first prototype object";
function storeLate(object) {
  object.late = 1;
  return object;
}
unseen(LateCreated);
var early = new LateCreated(1);
LateCreated.prototype = Object.create(LateCreatedBase.prototype);
LateCreated.prototype.tag = "LateCreated";
construct("constructed after the prototype object was replaced", function (x) { return storeLate(new LateCreated(x)); }, 2);
construct("constructed before the prototype object was replaced", function () { return storeLate(early); });

// Two calls give two parents.
function FirstParent() {}
FirstParent.prototype.tag = "FirstParent";
function SecondParent() {}
SecondParent.prototype.tag = "SecondParent";
Object.defineProperty(SecondParent.prototype, "b", accessor("second"));
function TwoParents(x) {
  this.a = x;
  this.b = x + 1;
}
function makeTwoParents(x) { return new TwoParents(x); }
function probeTwoParents(made) { return (made instanceof FirstParent) + " " + (made instanceof SecondParent); }
unseen(TwoParents);
inherits(TwoParents, FirstParent);
construct("under the first parent", makeTwoParents, 1, probeTwoParents);
inherits(TwoParents, SecondParent);
construct("under the second parent", makeTwoParents, 2, probeTwoParents);

// The text has a link that the program never makes.
function NeverBase() {}
NeverBase.prototype.tag = "NeverBase";
NeverBase.prototype.who = function () { return "NeverBase"; };
Object.defineProperty(NeverBase.prototype, "b", accessor("never"));
function NeverLinked(x) {
  this.a = x;
  this.b = x + 1;
}
NeverLinked.prototype.tag = "NeverLinked";
function linkNever() { inherits(NeverLinked, NeverBase); }
function makeNeverLinked(x) { return new NeverLinked(x); }
function probeNeverLinked(made) { return typeof made.who + " " + (made instanceof NeverBase); }
unseen(NeverLinked);
unseen(linkNever);
construct("the link stands in a function that never runs", makeNeverLinked, 1, probeNeverLinked);

function SkippedBase() {}
SkippedBase.prototype.tag = "SkippedBase";
SkippedBase.prototype.who = function () { return "SkippedBase"; };
Object.defineProperty(SkippedBase.prototype, "b", accessor("skipped"));
function Skipped(x) {
  this.a = x;
  this.b = x + 1;
}
Skipped.prototype.tag = "Skipped";
if (unseen(false))
  Object.setPrototypeOf(Skipped.prototype, SkippedBase.prototype);
function makeSkipped(x) { return new Skipped(x); }
function probeSkipped(made) { return typeof made.who + " " + (made instanceof SkippedBase); }
unseen(Skipped);
construct("the link stands under a condition that fails", makeSkipped, 1, probeSkipped);

function UndoneBase() {}
UndoneBase.prototype.tag = "UndoneBase";
UndoneBase.prototype.who = function () { return "UndoneBase"; };
Object.defineProperty(UndoneBase.prototype, "b", accessor("undone"));
function Undone(x) {
  this.a = x;
  this.b = x + 1;
}
Undone.prototype.tag = "Undone";
Object.setPrototypeOf(Undone.prototype, UndoneBase.prototype);
Object.setPrototypeOf(unseen(Undone).prototype, Object.prototype);
function makeUndone(x) { return new Undone(x); }
function probeUndone(made) { return typeof made.who + " " + (made instanceof UndoneBase); }
construct("the link is undone before the first construction", makeUndone, 1, probeUndone);

// The second link would close a circle, so it throws.
function Ring1(x) {
  this.a = x;
  this.b = x + 1;
}
Ring1.prototype.tag = "Ring1";
function Ring2() {}
Ring2.prototype.tag = "Ring2";
inherits(Ring1, Ring2);
lines.push("links that come back: " + attempt(function () { inherits(Ring2, Ring1); return "linked"; }));
lines.push("a link to itself: " + attempt(function () { Object.setPrototypeOf(Ring2.prototype, Ring2.prototype); return "linked"; }));
unseen(Ring1);
construct("in what is left of the circle", function (x) { return new Ring1(x); }, 1);

// The name of the parent gets another function after the link.
var Moving = function () {};
Moving.prototype.tag = "first Moving";
function BelowMoving(x) {
  this.a = x;
  this.b = x + 1;
}
inherits(BelowMoving, Moving);
BelowMoving.prototype.tag = "BelowMoving";
Moving = function () {};
Moving.prototype.tag = "second Moving";
Object.defineProperty(Moving.prototype, "b", accessor("second moving"));
unseen(BelowMoving);
construct("the name of the parent holds another function", function (x) { return new BelowMoving(x); }, 1, function (made) { return made instanceof Moving; });

// Three classes, each constructor calls the one above, and the accessor arrives on the topmost.
function Top() {
  this.top = 1;
}
Top.prototype.tag = "Top";
function Middle() {
  Top.call(this);
  this.middle = 2;
}
inherits(Middle, Top);
Middle.prototype.tag = "Middle";
function Bottom(x) {
  Middle.call(this);
  this.a = x;
  this.b = x + 1;
}
inherits(Bottom, Middle);
Bottom.prototype.tag = "Bottom";
function makeBottom(x) { return new Bottom(x); }
function probeBottom(made) { return (made instanceof Top) + " " + (made instanceof Middle); }
unseen(Bottom);
construct("three classes", makeBottom, 1, probeBottom);
Object.defineProperty(unseen(Top).prototype, "middle", accessor("top"));
construct("three classes, accessor for a field of the middle one", makeBottom, 2, probeBottom);
Object.defineProperty(unseen(Top).prototype, "b", accessor("top"));
construct("three classes, accessor for a field of the lowest one", makeBottom, 3, probeBottom);
construct("the middle one", function () { return new Middle(); });
Object.setPrototypeOf(unseen(Middle).prototype, Object.prototype);
construct("three classes, the middle one has left the topmost", makeBottom, 4, probeBottom);

// The lowest class is constructed before its parent has got a parent.
function Root() {
  this.root = 1;
}
Root.prototype.tag = "Root";
Object.defineProperty(Root.prototype, "b", accessor("root"));
function Inner() {
  Root.call(this);
  this.inner = 2;
}
Inner.prototype.tag = "Inner";
function Leaf(x) {
  Inner.call(this);
  this.a = x;
  this.b = x + 1;
}
inherits(Leaf, Inner);
Leaf.prototype.tag = "Leaf";
function makeLeaf(x) { return new Leaf(x); }
unseen(Leaf);
construct("the parent has no parent yet", makeLeaf, 1);
inherits(Inner, Root);
construct("the parent has got its parent", makeLeaf, 2);

// Two children of one parent. One of them leaves.
function Shared() {}
Shared.prototype.tag = "Shared";
function FirstChild(x) {
  this.a = x;
  this.b = x + 1;
}
inherits(FirstChild, Shared);
FirstChild.prototype.tag = "FirstChild";
function SecondChild(x) {
  this.a = x;
  this.b = x + 1;
}
inherits(SecondChild, Shared);
SecondChild.prototype.tag = "SecondChild";
function makeFirstChild(x) { return new FirstChild(x); }
function makeSecondChild(x) { return new SecondChild(x); }
function probeChild(made) { return made instanceof Shared; }
unseen(FirstChild);
unseen(SecondChild);
construct("the first child", makeFirstChild, 1, probeChild);
construct("the second child", makeSecondChild, 1, probeChild);
Object.setPrototypeOf(unseen(FirstChild).prototype, Object.defineProperty({ tag: "elsewhere" }, "b", accessor("elsewhere")));
construct("the first child has left", makeFirstChild, 2, probeChild);
construct("the second child has stayed", makeSecondChild, 2, probeChild);
Object.defineProperty(unseen(Shared).prototype, "b", accessor("shared"));
construct("the first child, accessor on the parent it has left", makeFirstChild, 3, probeChild);
construct("the second child, accessor on its parent", makeSecondChild, 3, probeChild);

// The parent is a class.
class ClassParent {
  get tag() { return "ClassParent"; }
  who() { return "ClassParent " + this.a; }
}
function UnderClass(x) {
  this.a = x;
  this.b = x + 1;
}
Object.setPrototypeOf(UnderClass.prototype, ClassParent.prototype);
function makeUnderClass(x) { return new UnderClass(x); }
function probeUnderClass(made) { return made.who() + " " + (made instanceof ClassParent); }
unseen(UnderClass);
construct("under a class", makeUnderClass, 1, probeUnderClass);
Object.defineProperty(unseen(ClassParent).prototype, "b", accessor("class"));
construct("under a class with an accessor", makeUnderClass, 2, probeUnderClass);
function CallsClass(x) {
  ClassParent.call(this);
  this.b = x;
}
inherits(CallsClass, ClassParent);
construct("the constructor calls the class", function (x) { return new CallsClass(x); }, 3);

// The function objects are linked as well.
function StaticBase() {}
StaticBase.label = "StaticBase";
StaticBase.create = function () { return "created by " + this.label; };
function StaticMade() {}
inherits(StaticMade, StaticBase);
function readStatic() { return (StaticMade.create ? StaticMade.create() : "nothing") + " " + StaticMade.label; }
unseen(StaticMade);
lines.push("before the function objects are linked: " + readStatic());
Object.setPrototypeOf(StaticMade, StaticBase);
lines.push("after the function objects are linked: " + readStatic());
StaticMade.label = "StaticMade";
lines.push("with a property of its own: " + readStatic());
Object.setPrototypeOf(unseen(StaticMade), Function.prototype);
lines.push("after the link is undone: " + readStatic());

// Another new.target, another receiver, and an object that is relinked before a function stores a name for the first time.
function Target() {}
Target.prototype = Object.defineProperty({ tag: "Target" }, "b", accessor("target"));
function ReflectBase() {}
ReflectBase.prototype.tag = "ReflectBase";
function Reflected(x) {
  this.a = x;
  this.b = x + 1;
}
inherits(Reflected, ReflectBase);
Reflected.prototype.tag = "Reflected";
function extend(object) {
  object.late = 1;
  return object;
}
unseen(Reflected);
construct("own new.target", function (x) { return new Reflected(x); }, 1);
construct("other new.target", function (x) { return Reflect.construct(Reflected, [x], Target); }, 2);
construct("the parent as new.target", function (x) { return Reflect.construct(Reflected, [x], ReflectBase); }, 3);
construct("called on an object literal", function (x) {
  var plain = { tag: "plain" };
  Reflected.call(plain, x);
  return plain;
}, 4);
construct("called on an object of the parent", function (x) {
  var base = new ReflectBase();
  Reflected.call(base, x);
  return base;
}, 5);
construct("a name stored later", function (x) { return extend(new Reflected(x)); }, 6);
construct("a name stored later under an accessor", function (x) {
  return extend(Object.setPrototypeOf(new Reflected(x), Object.defineProperty({ tag: "relinked" }, "late", accessor("relinked"))));
}, 7);
Object.defineProperty(unseen(ReflectBase).prototype, "late", accessor("base"));
construct("a name stored later under an accessor of the parent", function (x) { return extend(new Reflected(x)); }, 8);

// What a function stores that is called with the new object: between the stores of the constructor, under a condition, late, under a name of the constructor.
function Emitter() {
  this.events = 0;
  this.limit = 10;
}
Emitter.prototype.tag = "Emitter";
function Stream(x) {
  this.a = x;
  Emitter.call(this);
  this.b = x + 1;
}
inherits(Stream, Emitter);
Stream.prototype.tag = "Stream";
function makeStream(x) { return new Stream(x); }
unseen(Stream);
construct("the parent is called between two stores", makeStream, 1);
Object.defineProperty(unseen(Emitter).prototype, "limit", accessor("emitter"));
construct("accessor for a field that the parent stores", makeStream, 2);
delete unseen(Emitter).prototype.limit;
construct("the accessor is gone", makeStream, 3);
Object.defineProperty(unseen(Emitter), "call", { value: function () { noted.push("own call"); }, configurable: true });
construct("the parent has a call of its own", makeStream, 4);
delete unseen(Emitter).call;
construct("the parent has lost it", makeStream, 5);

function Optional(x, callsEmitter) {
  this.a = x;
  if (callsEmitter)
    Emitter.call(this);
  this.b = x + 1;
}
var flips = false;
unseen(Optional);
construct("the call is made", function (x) { return new Optional(x, true); }, 1);
construct("the call is left out", function (x) { return new Optional(x, false); }, 2);
construct("the call is made every other time", function (x) {
  flips = !flips;
  return new Optional(x, flips);
}, 3);

function Reordered(x, callsLate) {
  this.a = x;
  if (!callsLate)
    Emitter.call(this);
  this.b = x + 1;
  if (callsLate)
    Emitter.call(this);
}
unseen(Reordered);
construct("the call comes early or late", function (x) {
  flips = !flips;
  return new Reordered(x, flips);
}, 1);

function Counter() {
  this.count = 0;
  this.b = "stored by the callee";
}
function Counting(x) {
  this.b = x;
  Counter.call(this);
  this.count++;
}
unseen(Counting);
construct("both store one name", function (x) { return new Counting(x); }, 1);

function Named(first, second) {
  this.first = first;
  this.second = second;
}
function Forwarding() {
  Named.apply(this, arguments);
  this.b = arguments.length;
}
unseen(Forwarding);
construct("the arguments are handed on", function (x) { return new Forwarding(x); }, 1);
construct("two arguments are handed on", function (x) { return new Forwarding(x, x + 1); }, 2);

function Holder(x) {
  this.inner = {};
  Emitter.call(this.inner);
  this.b = x;
}
unseen(Holder);
construct("the callee gets another object", function (x) { return new Holder(x); }, 1);

function Returning() {
  this.kept = 1;
  return { tag: "returned" };
}
function UsesReturning(x) {
  Returning.call(this);
  this.b = x;
}
unseen(UsesReturning);
construct("the callee returns an object", function (x) { return new UsesReturning(x); }, 1);

function Again(x) {
  this.depth = x;
  if (x > 0)
    Again.call(this, x - 1);
  this.b = x;
}
unseen(Again);
construct("the constructor calls itself", function (x) { return new Again(x); }, 2);

var Swapped = function () {
  this.first = 1;
};
function UsesSwapped(x) {
  Swapped.call(this);
  this.b = x;
}
unseen(UsesSwapped);
construct("the callee before its name gets another function", function (x) { return new UsesSwapped(x); }, 1);
Swapped = function () {
  this.second = 2;
};
construct("the callee after its name got another function", function (x) { return new UsesSwapped(x); }, 2);

// Members that are copied into the prototype object. The copy reads each property once: it stores what a getter returns, and undefined where there is only a setter.
var reads = 0;
function Mixed(x) {
  this.a = x;
  this.b = x + 1;
}
Object.assign(Mixed.prototype, {
  tag: "Mixed",
  who: function () { return "mixed " + this.a; },
  get counted() { return ++reads; },
  set b(value) { noted.push("never copied " + value); },
});
function makeMixed(x) { return new Mixed(x); }
function probeMixed(made) { return made.who() + " " + made.counted + " " + reads + " " + Object.keys(Mixed.prototype).join(); }
unseen(Mixed);
construct("members copied into the prototype object", makeMixed, 1, probeMixed);
unseen(Mixed).prototype.who = function () { return "changed " + this.a; };
Object.defineProperty(unseen(Mixed).prototype, "b", accessor("mixed"));
construct("copied members are replaced", makeMixed, 2, probeMixed);

// The parent is a built-in class.
function Failure(message) {
  Error.call(this, message);
  this.name = "Failure";
  this.message = message;
}
inherits(Failure, Error);
Failure.prototype.tag = "Failure";
unseen(Failure);
construct("under Error", function (x) { return new Failure("text " + x); }, 1, function (made) { return String(made) + " " + (made instanceof Error); });

function List() {
  this.length = 0;
}
List.prototype = Object.create(Array.prototype);
List.prototype.constructor = List;
List.prototype.tag = "List";
unseen(List);
construct("under Array", function (x) {
  var list = new List();
  list.push(x, x + 1);
  return list;
}, 1, function (made) { return made.join("+") + " " + (made instanceof Array) + " " + Array.isArray(made); });

// The parent is a generator function.
function* Steps() {}
function Walker(x) {
  this.a = x;
  this.b = x + 1;
}
Object.setPrototypeOf(Walker.prototype, Steps.prototype);
Walker.prototype.tag = "Walker";
unseen(Walker);
construct("under a generator function", function (x) { return new Walker(x); }, 1, function (made) {
  return typeof made.next + " " + attempt(function () { return made.next(); }) + " " + (made instanceof Steps);
});

console.log(lines.join("\n"));
