// @ts-nocheck
// With "useDefineForClassFields": false the constructor evaluates the fields, so `arguments` in a direct eval there is the constructor's.
function show(label, make) {
  try {
    console.log(label, JSON.stringify(make()));
  } catch (error) {
    console.log(label, error.name);
  }
}
class Written {
  count = eval("arguments.length");
  kind = eval("typeof arguments");
  first = eval("arguments[0]");
  constructor(p, q) {}
}
show("written", () => new Written(1, 2));
class Unwritten {
  count = eval("arguments.length");
}
show("unwritten", () => new Unwritten(1, 2, 3));
class Base {
  constructor(...all) {
    this.base = all.length;
  }
}
class DerivedWritten extends Base {
  count = eval("arguments.length");
  constructor(p, q) {
    super(p);
  }
}
show("derived, written", () => new DerivedWritten(1, 2));
class DerivedUnwritten extends Base {
  count = eval("arguments.length");
  last = eval("arguments[3]");
}
show("derived, unwritten", () => new DerivedUnwritten(1, 2, 3, 4));
class WithRest {
  count = eval("arguments.length");
  constructor(p, ...rest) {
    this.rest = rest.length;
  }
}
show("rest parameter", () => new WithRest(1, 2, 3));
class InArrow {
  read = () => eval("arguments.length");
  constructor(p, q, r) {}
}
show("in an arrow function", () => new InArrow(1, 2, 3).read(9));
class InFunction {
  read = function () {
    return eval("arguments.length");
  };
  constructor(p) {}
}
show("in a function", () => new InFunction(1).read(9, 8));
class Twice {
  a = eval("arguments.length");
  b = eval("arguments.length + 1");
  constructor(p, q) {
    this.c = arguments.length;
  }
}
show("two fields and the body", () => new Twice(1, 2));
class Callee {
  kind = eval("typeof arguments.callee");
}
show("callee", () => new Callee());
class Static {
  static kind = (() => {
    try {
      return eval("arguments.length");
    } catch (error) {
      return error.name;
    }
  })();
}
show("a static field", () => Static.kind);
