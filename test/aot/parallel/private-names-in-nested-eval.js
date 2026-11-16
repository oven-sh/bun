// An eval inside evaluated source sees the private names of the classes around the outer eval.
class Fields {
  #p = 1;
  static #s = 2;
  read() {
    return eval('eval("this.#p")');
  }
  write(value) {
    eval('eval("this.#p = value")');
    return this.#p;
  }
  has(object) {
    return eval('eval("#p in object")');
  }
  static readStatic() {
    return eval('eval("Fields.#s")');
  }
  threeDeep() {
    return eval(`eval('eval("this.#p + 10")')`);
  }
  strict() {
    "use strict";
    return eval('"use strict"; eval("this.#p + 20")');
  }
  inArrow() {
    return eval('(() => eval("this.#p + 30"))()');
  }
  inFunction() {
    return eval('(function (self) { return eval("self.#p + 40"); })(this)');
  }
}
class Methods {
  #m() {
    return "method";
  }
  get #g() {
    return "getter";
  }
  static #sm() {
    return "static method";
  }
  call() {
    return eval('eval("this.#m() + this.#g")');
  }
  static callStatic() {
    return eval('eval("Methods.#sm()")');
  }
}
class Outer {
  #o = "outer";
  make() {
    const outer = this;
    return class Inner {
      #i = "inner";
      both() {
        return eval('eval("outer.#o + this.#i")');
      }
    };
  }
}
const fields = new Fields();
console.log(fields.read(), fields.write(5), fields.has(fields), fields.has({}), Fields.readStatic());
console.log(fields.threeDeep(), fields.strict(), fields.inArrow(), fields.inFunction());
console.log(new Methods().call(), Methods.callStatic());
console.log(new (new Outer().make())().both());
for (const source of ['eval("this.#missing")', 'eval("class X { m() { return this.#other; } }")']) {
  try {
    console.log(function () { return eval(source); }.call(fields));
  } catch (error) {
    console.log(error.name, error.message);
  }
}
class Undeclared {
  #p = 1;
  m() {
    try {
      return eval('eval("this.#q")');
    } catch (error) {
      return error.name + ": " + error.message;
    }
  }
}
console.log(new Undeclared().m());
