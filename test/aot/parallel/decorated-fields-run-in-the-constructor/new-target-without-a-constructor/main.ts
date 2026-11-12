function mark(_target: unknown, _key: string) {}
class Gauge { // @ts-expect-error
  @mark made = new.target === undefined ? "undefined" : (new.target as any).name; // @ts-expect-error
  plain = new.target === undefined ? "undefined" : (new.target as any).name;
}
class Base {}
class Derived extends Base { // @ts-expect-error
  @mark made = new.target === undefined ? "undefined" : (new.target as any).name;
}
console.log(new Gauge().made, new Gauge().plain, new Derived().made);
