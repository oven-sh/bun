// Getters and setters of classes and of literals.
class Temperature {
  #celsius = 0;
  static #instances = 0;
  constructor() {
    Temperature.#instances++;
  }
  get fahrenheit(): number {
    return this.#celsius * 1.8 + 32;
  }
  set fahrenheit(value: number) {
    this.#celsius = (value - 32) / 1.8;
  }
  static get instances(): number {
    return Temperature.#instances;
  }
}
const t = new Temperature();
t.fahrenheit = 212;
console.log(t.fahrenheit, Temperature.instances);
const object = {
  _value: 1,
  get value() {
    return this._value;
  },
  set value(next: number) {
    this._value = next * 2;
  },
};
object.value = 5;
object.value += 1;
console.log(object.value, Object.getOwnPropertyDescriptor(object, "value")!.get !== undefined);
const defined = Object.defineProperty({} as { lazy: number }, "lazy", { get: () => 42, enumerable: true });
console.log(defined.lazy, JSON.stringify(defined));
