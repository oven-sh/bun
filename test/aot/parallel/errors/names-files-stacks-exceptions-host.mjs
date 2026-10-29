// Prints the own properties and the lines `name@file` of the stacks of the DOMException objects that host functions make. The functions in the frames take their names from declarations, variables, properties, keys in
// brackets, symbols, classes, `displayName` and a `name` that is defined later. Some run below callbacks of built-in functions and some are made of text by `new Function` and `eval`.
const file = /[^ @()]*names-files-stacks-exceptions-host\.mjs(:\d+:\d+)?/g;
let kept;
function reason() {
  const controller = new AbortController();
  controller.abort();
  return controller.signal.reason;
}
function describe(exception) {
  return [
    Object.getOwnPropertyNames(exception).join(","),
    String(exception.sourceURL).replace(file, "file"),
    String(exception.stack)
      .replace(file, "file")
      .replace(/:\d+:\d+/g, "")
      .split("\n")
      .join(" < "),
  ].join(" | ");
}
function show(name, run) {
  try {
    console.log(name, "|", describe(run()));
  } catch (exception) {
    console.log(name, "| thrown |", describe(exception));
  }
}
const key = String("computed");
const symbol = Symbol("described");
const object = {
  method() {
    const r = reason();
    kept = r;
    return r;
  },
  get getter() {
    const r = reason();
    kept = r;
    return r;
  },
  set setter(v) {
    const r = reason();
    kept = r;
  },
  [key]() {
    const r = reason();
    kept = r;
    return r;
  },
  [symbol]() {
    const r = reason();
    kept = r;
    return r;
  },
  get [key + "Getter"]() {
    const r = reason();
    kept = r;
    return r;
  },
  arrow: () => {
    const r = reason();
    kept = r;
    return r;
  },
  [key + "Arrow"]: () => {
    const r = reason();
    kept = r;
    return r;
  },
  expression: function () {
    const r = reason();
    kept = r;
    return r;
  },
  namedExpression: function inner() {
    const r = reason();
    kept = r;
    return r;
  },
  *generator() {
    const r = reason();
    kept = r;
    yield r;
  },
  async asyncMethod() {
    const r = reason();
    kept = r;
    return r;
  },
  "quoted name"() {
    const r = reason();
    kept = r;
    return r;
  },
  7() {
    const r = reason();
    kept = r;
    return r;
  },
};
show("method", () => object.method());
show("getter", () => object.getter);
show("setter", () => {
  object.setter = 1;
  return kept;
});
show("computed", () => object[key]());
show("symbol", () => object[symbol]());
show("computed getter", () => object[key + "Getter"]);
show("arrow", () => object.arrow());
show("computed arrow", () => object[key + "Arrow"]());
show("expression", () => object.expression());
show("named expression", () => object.namedExpression());
show("generator method", () => object.generator().next().value);
show("quoted", () => object["quoted name"]());
show("number", () => object[7]());
const variableArrow = () => {
  const r = reason();
  kept = r;
  return r;
};
const variableFunction = function () {
  const r = reason();
  kept = r;
  return r;
};
const variableGenerator = function* () {
  const r = reason();
  kept = r;
  yield r;
};
function* declaredGenerator() {
  const r = reason();
  kept = r;
  yield r;
}
let assigned;
assigned = () => {
  const r = reason();
  kept = r;
  return r;
};
const holder = {};
holder.member = () => {
  const r = reason();
  kept = r;
  return r;
};
holder.memberFunction = function () {
  const r = reason();
  kept = r;
  return r;
};
show("variable arrow", variableArrow);
show("variable function", variableFunction);
show("variable generator", () => variableGenerator().next().value);
show("declared generator", () => declaredGenerator().next().value);
show("assigned", assigned);
show("member", () => holder.member());
show("member function", () => holder.memberFunction());
function withDefault(
  f = () => {
    const r = reason();
    kept = r;
    return r;
  },
) {
  const r = f();
  kept = r;
  return r;
}
show("default", () => withDefault());
const {
  pattern = () => {
    const r = reason();
    kept = r;
    return r;
  },
} = {};
show("pattern", pattern);
class Base {
  constructor() {
    this.reason = reason();
    kept = this;
  }
  field = reason();
  static staticField = reason();
  static staticReason;
  static {
    Base.staticReason = reason();
    kept = Base;
  }
  #hidden() {
    const r = reason();
    kept = r;
    return r;
  }
  callHidden() {
    const r = this.#hidden();
    kept = r;
    return r;
  }
  static [key]() {
    const r = reason();
    kept = r;
    return r;
  }
  get accessor() {
    const r = reason();
    kept = r;
    return r;
  }
  static get staticAccessor() {
    const r = reason();
    kept = r;
    return r;
  }
}
class Derived extends Base {
  constructor() {
    super();
    kept = this;
  }
}
class Implicit extends Base {}
const Anonymous = class {
  constructor() {
    this.reason = reason();
    kept = this;
  }
};
const NamedClass = class Inner {
  constructor() {
    this.reason = reason();
    kept = this;
  }
};
show("constructor", () => new Base().reason);
show("field", () => new Base().field);
show("static field", () => Base.staticField);
show("static block", () => Base.staticReason);
show("private", () => new Base().callHidden());
show("static computed", () => Base[key]());
show("accessor", () => new Base().accessor);
show("static accessor", () => Base.staticAccessor);
show("derived", () => new Derived().reason);
show("implicit", () => new Implicit().reason);
show("anonymous class", () => new Anonymous().reason);
show("named class", () => new NamedClass().reason);
function looked() {
  const r = reason();
  kept = r;
  return r;
}
kept = looked.name;
show("name read", looked);
const lookedArrow = () => {
  const r = reason();
  kept = r;
  return r;
};
kept = lookedArrow.name;
show("name of an arrow read", lookedArrow);
kept = object[key].name;
show("name of a computed read", () => object[key]());
function both() {
  const r = reason();
  kept = r;
  return r;
}
Object.defineProperty(both, "name", { value: "bothRenamed" });
both.displayName = "bothDisplayed";
show("name and displayName", both);
function emptyDisplay() {
  const r = reason();
  kept = r;
  return r;
}
emptyDisplay.displayName = "";
show("empty displayName", emptyDisplay);
function numberDisplay() {
  const r = reason();
  kept = r;
  return r;
}
numberDisplay.displayName = 5;
show("displayName is a number", numberDisplay);
function getterDisplay() {
  const r = reason();
  kept = r;
  return r;
}
Object.defineProperty(getterDisplay, "displayName", { get: () => "got" });
show("displayName is a getter", getterDisplay);
function deleted() {
  const r = reason();
  kept = r;
  return r;
}
delete deleted.name;
show("name deleted", deleted);
function emptied() {
  const r = reason();
  kept = r;
  return r;
}
Object.defineProperty(emptied, "name", { value: "" });
show("name emptied", emptied);
function makeClosure() {
  return function made() {
    const r = reason();
    kept = r;
    return r;
  };
}
const first = makeClosure(),
  second = makeClosure();
Object.defineProperty(first, "name", { value: "firstRenamed" });
second.displayName = "secondDisplayed";
show("first of two closures", first);
show("second of two closures", second);
show("third closure", makeClosure());
Base.displayName = "BaseDisplayed";
show("class with displayName", () => new Base().reason);
Object.defineProperty(Derived, "name", { value: "DerivedRenamed" });
show("class renamed", () => new Derived().reason);
class StaticName {
  static name = "fromStatic";
  constructor() {
    this.reason = reason();
    kept = this;
  }
}
show("class with a static name", () => new StaticName().reason);
class StaticDisplay {
  static displayName = "fromStaticDisplay";
  constructor() {
    this.reason = reason();
    kept = this;
  }
}
show("class with a static displayName", () => new StaticDisplay().reason);
const bound = looked.bind(null);
show("bound", bound);
async function asyncFunction() {
  const a = reason();
  await null;
  const b = reason();
  kept = a;
  return [a, b];
}
const asyncArrow = async () => {
  const a = reason();
  await null;
  const b = reason();
  kept = a;
  return [a, b];
};
async function asyncCaller() {
  const r = await asyncFunction();
  kept = r;
  return r;
}
async function asyncArrowCaller() {
  const r = await asyncArrow();
  kept = r;
  return r;
}
async function* asyncGenerator() {
  const a = reason();
  yield a;
  await null;
  yield reason();
}
for (const [name, run] of [
  ["async", asyncCaller],
  ["async arrow", asyncArrowCaller],
]) {
  const [a, b] = await run();
  show(name + " first", () => a);
  show(name + " second", () => b);
}
Object.defineProperty(asyncFunction, "name", { value: "asyncRenamed" });
asyncCaller.displayName = "asyncCallerDisplayed";
{
  const [a, b] = await asyncCaller();
  show("async renamed first", () => a);
  show("async renamed second", () => b);
}
{
  const steps = asyncGenerator();
  const a = (await steps.next()).value,
    b = (await steps.next()).value;
  show("async generator first", () => a);
  show("async generator second", () => b);
}
declaredGenerator.displayName = "generatorDisplayed";
show("generator with displayName", () => declaredGenerator().next().value);
Object.defineProperty(declaredGenerator, "name", { value: "generatorRenamed" });
show("generator renamed", () => declaredGenerator().next().value);
object.method.displayName = "methodDisplayed";
show("method with displayName", () => object.method());
object[key].displayName = "computedDisplayed";
show("computed with displayName", () => object[key]());
variableArrow.displayName = "arrowDisplayed";
show("arrow with displayName", variableArrow);
delete variableArrow.displayName;
show("arrow without displayName again", variableArrow);
const constantKey = "constant";
const more = {
  [constantKey]() {
    const r = reason();
    kept = r;
    return r;
  },
  ["literal"]() {
    const r = reason();
    kept = r;
    return r;
  },
  [`template`]() {
    const r = reason();
    kept = r;
    return r;
  },
  ["joined" + "Key"]() {
    const r = reason();
    kept = r;
    return r;
  },
  [Symbol.iterator]() {
    const r = reason();
    kept = r;
    return r;
  },
  *[Symbol.asyncIterator]() {
    const r = reason();
    kept = r;
    yield r;
  },
  get [Symbol.toStringTag]() {
    const r = reason();
    kept = r;
    return r;
  },
  [constantKey + "Arrow"]: () => {
    const r = reason();
    kept = r;
    return r;
  },
  [Symbol.match]: function () {
    const r = reason();
    kept = r;
    return r;
  },
  [Symbol.split]: class {
    constructor() {
      this.reason = reason();
      kept = this;
    }
  },
  [8]() {
    const r = reason();
    kept = r;
    return r;
  },
};
show("constant key", () => more[constantKey]());
show("literal key", () => more.literal());
show("template key", () => more.template());
show("joined key", () => more.joinedKey());
show("well-known symbol", () => more[Symbol.iterator]());
show("generator under a symbol", () => more[Symbol.asyncIterator]().next().value);
show("getter under a symbol", () => more[Symbol.toStringTag]);
show("arrow under a joined key", () => more.constantArrow());
show("function under a symbol", () => more[Symbol.match]());
show("class under a symbol", () => new more[Symbol.split]().reason);
show("number in brackets", () => more[8]());
class Keys {
  [constantKey]() {
    const r = reason();
    kept = r;
    return r;
  }
  static [Symbol.hasInstance]() {
    const r = reason();
    kept = r;
    return r;
  }
  [symbol] = () => {
    const r = reason();
    kept = r;
    return r;
  };
  named = () => {
    const r = reason();
    kept = r;
    return r;
  };
  static [constantKey + "Field"] = function () {
    const r = reason();
    kept = r;
    return r;
  };
}
show("class constant key", () => new Keys()[constantKey]());
show("class static symbol", () => Keys[Symbol.hasInstance]());
show("field under a symbol", () => new Keys()[symbol]());
show("field", () => new Keys().named());
show("static field under a joined key", () => Keys.constantField());
show("replace", () => {
  let reason;
  "a".replace(/a/, () => ((reason = reason()), ""));
  return reason;
});
show("replace a string", () => {
  let reason;
  "a".replace("a", () => ((reason = reason()), ""));
  return reason;
});
show("replaceAll", () => {
  let reason;
  "a".replaceAll("a", () => ((reason = reason()), ""));
  return reason;
});
show("map", () => [1].map(() => reason())[0]);
show("forEach", () => {
  let reason;
  [1].forEach(() => {
    reason = reason();
  });
  return reason;
});
show("sort", () => {
  let reason;
  [1, 2].sort(() => ((reason = reason()), 0));
  return reason;
});
show("Array.from", () => Array.from([1], () => reason())[0]);
show("reduce", () => [1, 2].reduce(() => reason()));
show("JSON.parse", () => {
  let reason;
  JSON.parse("1", () => ((reason = reason()), 0));
  return reason;
});
show("Map forEach", () => {
  let reason;
  new Map([[1, 1]]).forEach(() => {
    reason = reason();
  });
  return reason;
});
show("Reflect.apply", () => Reflect.apply(reason, null, []));
show("toString", () => {
  let reason;
  `${{ toString: () => ((reason = reason()), "") }}`;
  return reason;
});
show("evaluated text", () => new Function("make", "const reason = make(); return reason;")(reason));
show("evaluated text aborts", () =>
  new Function("const c = new AbortController(); c.abort(); return c.signal.reason;")(),
);
show("eval", () => (0, eval)("const c = new AbortController(); c.abort(); c.signal.reason;"));
show("eval calls", () => {
  globalThis.make = reason;
  return (0, eval)("const reason = make(); reason;");
});
show("abort below replace", () => {
  const controller = new AbortController();
  "a".replace(/a/, controller.abort.bind(controller));
  return controller.signal.reason;
});
show("abort below replace of a string", () => {
  const controller = new AbortController();
  "a".replace("a", controller.abort.bind(controller));
  return controller.signal.reason;
});
show("abort below map", () => {
  const controller = new AbortController();
  [undefined].map(controller.abort, controller);
  return controller.signal.reason;
});
show("split", () => {
  let reason;
  "a".split({ [Symbol.split]: () => ((reason = reason()), []) });
  return reason;
});
show("match", () => {
  let reason;
  "a".match({ [Symbol.match]: () => ((reason = reason()), null) });
  return reason;
});
show("evaluated text with a name for its source", () =>
  new Function("make", "const reason = make(); return reason;\n//# sourceURL=named-text.js")(reason),
);
