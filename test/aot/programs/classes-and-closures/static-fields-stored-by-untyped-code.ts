// Untyped code stores, redefines and deletes the static fields of a class and gives a subclass another parent. No store throws, and typed code reads what plain Bun reads.
class C {
  static count: number = 0;
  static label: string | undefined;
  static read() {
    return C.count + 1;
  }
  static write(count: number) {
    C.count = count;
  }
}
class Sub extends C {}
class Other {
  static count: number = 100;
}

const U: any = C;
const S: any = Sub;

function show(step: string) {
  console.log(step, C.read(), C.label, Sub.count);
}
function attempt(action: () => unknown) {
  try {
    return action();
  } catch (error: any) {
    return error.constructor.name;
  }
}

show("initial");
U.count = 5;
show("assignment");
console.log(Reflect.set(U, "count", 6));
show("Reflect.set");

const receiver: any = {};
console.log(Reflect.set(U, "count", "text", receiver), receiver.count);
show("Reflect.set with another receiver");

S.count = 50;
show("own property of the subclass");
console.log(delete S.count);
show("deleted from the subclass");

Object.defineProperty(U, "count", { value: 7, writable: true, enumerable: true, configurable: true });
show("defineProperty with the same attributes");
Object.defineProperty(U, "count", { value: 8, writable: false });
show("defineProperty, read-only");
console.log(Reflect.set(U, "count", 9), attempt(() => C.write(9)));
show("stores to a read-only property");
Object.defineProperty(U, "count", { get: () => 11 });
show("defineProperty with a getter");

U.label = "first";
show("label stored");
console.log(delete U.label, "label" in C);
show("label deleted");
U.label = "second";
show("label added again");
console.log(Object.keys(U).join());

Object.setPrototypeOf(Sub, Other);
show("setPrototypeOf");
console.log(Object.getPrototypeOf(Sub) === Other, attempt(() => S.read()));

// From here on typed code does not read C.label.
U.label = 42;
console.log(U.label, Reflect.get(U, "label"), C.read());

class D {
  static size: number = 1;
  static tag: string | undefined = "t";
  static read() {
    return D.size + 1;
  }
}
const V: any = D;
console.log(D.read(), D.tag);
V.tag = 42;
V.size = 2;
console.log(V.tag, D.read());
Object.defineProperty(V, "tag", { value: 43 });
D.size = 3;
console.log(V.tag, V.size, D.read());

function f() {}
const p = { marker: "p" };
const F: any = f;
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(f, "prototype")), F.prototype.constructor === f);
f.prototype = p;
console.log(F.prototype === p, new F().marker, Object.getPrototypeOf(new F()) === p);
console.log(Reflect.deleteProperty(f, "prototype"), attempt(() => delete F.prototype), F.prototype === p);

const generatorPrototype = Object.getOwnPropertyDescriptor(function* () {}, "prototype")!;
console.log(generatorPrototype.writable, generatorPrototype.enumerable, generatorPrototype.configurable);
