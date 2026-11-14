"use strict";
const outer = "outer";
class Evals {
  a = eval("outer + 1");
  b;
  constructor(b) {
    this.b = b;
  }
}
class InArrow {
  a = () => eval("this.b + outer");
  b;
  constructor(b) {
    this.b = b;
  }
}
class Target {
  a = eval("new.target");
  c = () => eval("typeof new.target");
  b;
  constructor(b) {
    this.b = b;
  }
}
class Names {
  a = [eval("typeof b"), eval("typeof Names")];
  b;
  constructor(b) {
    this.b = b;
  }
}
class Arguments {
  a = () => eval("arguments");
  b;
  constructor(b) {
    this.b = b;
  }
}
class BodyEval {
  list = [outer];
  b;
  constructor(b) {
    this.b = b;
    this.c = eval("b + this.list[0]");
  }
}
for (let i = 0; i < 2; i++) {
  console.log(JSON.stringify(new Evals(i)), new InArrow(i).a(), JSON.stringify(new Target(i)), new Target(i).c(), JSON.stringify(new Names(i)), JSON.stringify(new BodyEval(i)));
  try {
    console.log(new Arguments(i).a());
  } catch (error) {
    console.log(error.name, error.message);
  }
}
var sloppy = new Function("class S { m = [1, () => this.x]; x; constructor(x) { this.x = x; } } return new S(4).m[1]()");
console.log(sloppy());
