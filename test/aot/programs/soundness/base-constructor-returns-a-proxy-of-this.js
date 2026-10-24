let raw;
const log = [];
class A {
  constructor() {
    this.x = 1;
    raw = this;
    return new Proxy(this, {
      defineProperty(target, key, descriptor) {
        log.push("define " + String(key) + " " + descriptor.value);
        return Reflect.defineProperty(target, key, descriptor);
      },
    });
  }
}
class B extends A {
  s = 5;
  t = (this.s = "again");
  m() {
    return "B.m " + this.s;
  }
}
const o = new B();
console.log(o === raw, o.x, o.s, o.t, o.m());
console.log(raw.x, raw.s, raw.t, raw.m(), Object.keys(raw).join(), raw instanceof B);
console.log(log.join());
