// @ts-nocheck: the checker refuses new.target in a field (TS17013)
// With "useDefineForClassFields": false the constructor evaluates the fields, so new.target is the constructor's.
const nameOf = (value: unknown) => (typeof value === "function" ? value.name : String(value));
class Base {
  direct = new.target;
  inArrow = (() => new.target)();
  inNestedArrow = (() => () => new.target)()();
  inFunction = (function () { return new.target; })();
  evaluated = eval("new.target");
}
class Derived extends Base {
  own = new.target;
}
class WithConstructor extends Base {
  own = new.target;
  later: unknown;
  constructor(public parameter = new.target) {
    super();
    this.later = new.target;
  }
}
function list(object: object) {
  return Object.entries(object).map(([key, value]) => key + "=" + nameOf(value)).join(" ");
}
console.log(list(new Base()));
console.log(list(new Derived()));
console.log(list(new WithConstructor()));
console.log(list(Reflect.construct(Base, [], Derived)));
console.log(list(Reflect.construct(WithConstructor, [], Base)));
