const given = "outer given", later = "outer later", fixed = "outer fixed", helper = "outer helper";
function attempt(read: () => any) {
  try {
    return read();
  } catch (error: any) {
    return error.constructor.name;
  }
}
class Parameter {
  x: any = eval("arguments[0] + ' ' + typeof given + ' ' + given");
  constructor(given: number) {}
}
console.log(new Parameter(1).x);
class Body {
  variable: any = eval("typeof later");
  constant: any = attempt(() => eval("fixed"));
  declared: any = eval("typeof helper");
  read: any = () => eval("fixed + later");
  constructor() {
    var later = 1;
    const fixed = 2;
    function helper() {}
  }
}
const body = new Body();
console.log(body.variable, body.constant, body.declared, body.read());
class Stored {
  x: any = eval("given = 'stored'");
  seen: any;
  constructor(given: string) {
    this.seen = given;
  }
}
console.log(new Stored("passed").seen, given);
class Base {
  constructor(public first: any) {}
}
class Derived extends Base {
  x: any = eval("typeof given + ' ' + arguments.length");
  constructor(given: number, _second: number) {
    super(given);
  }
}
console.log(new Derived(1, 2).x);
class Patterns {
  x: any = eval("first + second + rest.length + other");
  constructor({ first, second }: any, other = first + 1, ...rest: any[]) {}
}
console.log(new Patterns({ first: 1, second: 2 }, undefined, 0, 0).x);
class InAFunction {
  arrow: any = (() => eval("typeof given"))();
  plain: any = (function () {
    return eval("typeof given");
  })();
  constructor(given: number) {}
}
console.log(new InAFunction(1).arrow, new InAFunction(1).plain);
class Inner {
  made: any = new (class {
    x: any = eval("typeof given");
  })().x;
  constructor(given: number) {}
}
console.log(new Inner(1).made);
class WrittenOut {
  x: any = typeof given;
  y: any = eval("typeof given");
  constructor(given: number) {}
}
console.log(new WrittenOut(1).x, new WrittenOut(1).y);
class Shared {
  static x: any = eval("typeof given");
  constructor(given: number) {}
}
console.log(Shared.x);
class NoConstructor {
  x: any = eval("typeof given");
}
console.log(new NoConstructor().x);
