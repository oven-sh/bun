class Base {
  constructor(public name: string) {}
}
class Derived extends Base {
  constructor() {
    super("derived");
  }
}
console.log(new Derived().name, new Derived() instanceof Base);
