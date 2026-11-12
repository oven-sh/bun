// What a constructor stores behind super() is stored once, where a resource is declared in front of super() too.
const log = [];
const resource = { [Symbol.dispose]() { log.push("disposed"); } };
class Shown {
  constructor() {
    return new Proxy({}, {
      defineProperty(target, key, descriptor) { log.push("define " + key + " " + descriptor.value); return Reflect.defineProperty(target, key, descriptor); },
      set(target, key, value, receiver) { log.push("set " + key + " " + value); return Reflect.set(target, key, value, receiver); },
    });
  }
}
class First extends Shown {
  a;
  b = 0;
  constructor(value) {
    using held = resource;
    super();
    this.a = value;
    this.b = 5;
    log.push("end");
  }
}
class Second extends Shown {
  a;
  constructor(value) {
    super();
    this.a = value;
    using held = resource;
    this.a = 7;
  }
}
class Plain { kind = "plain"; }
class Third extends Plain {
  a;
  b = 1;
  constructor(value) {
    log.push("in front");
    using held = resource;
    super();
    this.a = value;
    this.b = "b";
    log.push(this.kind, this.a, this.b);
  }
}
for (const made of [First, Second, Third]) {
  const object = new made(3);
  console.log(made.name, log.splice(0).join(", "), object.a, object.b);
}
