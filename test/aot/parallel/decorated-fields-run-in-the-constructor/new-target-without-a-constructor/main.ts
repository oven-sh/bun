function mark(_target: unknown, _key: string) {}
class Gauge {
  @mark made = new.target === undefined ? "undefined" : (new.target as any).name;
  plain = new.target === undefined ? "undefined" : (new.target as any).name;
}
class Base {}
class Derived extends Base {
  @mark made = new.target === undefined ? "undefined" : (new.target as any).name;
}
console.log(new Gauge().made, new Gauge().plain, new Derived().made);
