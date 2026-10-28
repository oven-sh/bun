// Instances, classes and functions get symbols between names, as fields, by stores in a constructor and as static fields; each is printed.
function pick(name) {
  return Symbol[name];
}
function show(label, made) {
  console.log(label, made);
  console.log(label, "own keys", Reflect.ownKeys(made));
  console.log(label, "assigned", Object.assign({}, made));
  console.log(label, "spread", { ...made });
}
const first = pick("asyncDispose");
const second = pick("iterator");
class Fields {
  [first] = 1;
  size = 2;
  [second] = 3;
  count = 4;
}
show("fields", new Fields());
class Stores {
  constructor(key) {
    this[key] = 1;
    this.size = 2;
    this[second] = 3;
    this.count = 4;
  }
}
show("stores", new Stores(first));
show("stores, fresh", new Stores(Symbol("fresh")));
class Below extends Stores {
  more = 5;
  [pick("hasInstance")] = 6;
  last = 7;
}
show("below", new Below(first));
class Statics {
  static [first] = 1;
  static size = 2;
  static [second] = 3;
  static count = 4;
}
console.log("statics", Statics);
console.log("statics", Reflect.ownKeys(Statics));
function plain() {}
plain[first] = 1;
plain.size = 2;
plain[second] = 3;
plain.count = 4;
console.log("function", plain);
console.log("function", Reflect.ownKeys(plain));
function Old(key) {
  this[key] = 1;
  this.size = 2;
}
show("constructor function", new Old(first));
class Private {
  #hidden = 0;
  [first] = 1;
  size = 2;
  read() {
    return this.#hidden;
  }
}
show("private", new Private());
