// A constructor of a derived class evaluates a text, so the text may call super() and the fields are laid by a method. Fields that hold `this` stand behind a private one and a plain one.
class Parent {}
class First extends Parent {
  #secret;
  plain;
  itself = () => this;
  constructor(text) {
    super();
    this.answer = eval(text);
  }
  get secret() {
    return this.#secret;
  }
}
class Second extends Parent {
  #secret = 1;
  plain = 2;
  later = () => [this.#secret, this.plain, this.behind];
  behind = eval("this.plain + 1");
  seen = { object: this };
  constructor(text) {
    eval(text);
  }
}
class Third extends First {
  #own = () => this;
  a = this.#own;
  b = (() => this)();
  static made = () => this;
  static { this.kept = this; }
  constructor(text) {
    try {
      super("1");
    } finally {
      eval(text);
    }
  }
}
const first = new First("this.plain = 5; 7");
console.log(first.plain, first.answer, first.itself() === first, first.secret);
const second = new Second("super()");
console.log(second.later().join(), second.seen.object === second);
for (const text of ["1", "super()", "var x = () => super(); x()"]) {
  try {
    console.log(Object.keys(new Second(text)).join());
  } catch (error) {
    console.log(error.name);
  }
}
const third = new Third("this.plain = 9");
console.log(third.a() === third, third.b === third, third.plain, Third.made() === Third, Third.kept === Third);
const proxies = [];
class Shown { constructor() { return new Proxy({}, { defineProperty(target, key, descriptor) { proxies.push(String(key)); return Reflect.defineProperty(target, key, descriptor); } }); } }
class Fourth extends Shown {
  #secret = 3;
  plain;
  itself = () => this;
  constructor(text) {
    super();
    eval(text);
  }
}
const fourth = new Fourth("1");
console.log(proxies.join(), fourth.itself() === fourth);
