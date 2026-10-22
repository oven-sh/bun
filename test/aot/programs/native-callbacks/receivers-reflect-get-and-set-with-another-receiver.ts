// Receivers below an accessor: Reflect.get and Reflect.set run the accessors of a class with a receiver that is no instance: a plain object with a string in the field, a primitive, a proxy.
let total = 0;

class Thermometer {
  degrees = 20;
  get next(): number {
    total += this instanceof Thermometer ? 1 : 100;
    return this.degrees + 1;
  }
  set next(value: number) {
    total += this instanceof Thermometer ? 10000 : 1000000;
    this.degrees = value - 1;
  }
}

const honest = new Thermometer();
honest.next = honest.next + 1;
const plain: any = { degrees: "7" };
const results: unknown[] = [
  honest.degrees,
  Reflect.get(honest, "next", plain),
  Reflect.get(honest, "next", "text"),
  Reflect.get(honest, "next", 5),
  Reflect.get(Thermometer.prototype, "next"),
  Reflect.get(honest, "next", new Proxy({}, { get: () => "40" })),
  Reflect.set(honest, "next", "9", plain),
  plain.degrees,
  Reflect.set(honest, "next", 3, Object.create(honest)),
  honest.degrees,
];
console.log(total, results.map(one => typeof one + ":" + String(one)).join());
