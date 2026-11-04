class Base { kind = "base"; hello() { return "hello " + this.kind; } }
class Derived extends Base {
  said: string;
  constructor() {
    const init = () => super();
    const target = () => new.target === Derived;
    init();
    const greet = () => super.hello();
    this.kind = "derived";
    this.said = greet() + ":" + target();
  }
}
console.log(new Derived().said);
