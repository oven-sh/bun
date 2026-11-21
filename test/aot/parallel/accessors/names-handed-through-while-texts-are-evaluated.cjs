// The accessors of a prototype read this[where][name]; evaluated texts change the place, what it holds, its accessors, and those of the prototype.
// STATISTIC: AccessesDispatchedByKeyString >= 6
// STATISTIC: GettersExpectedInLoops >= 5
"use strict";
function handing(prototype, where, names) {
  for (const name of names) {
    Object.defineProperty(prototype, name, {
      get() {
        return this[where][name];
      },
      set(value) {
        this[where][name] = value;
      },
      configurable: true,
    });
  }
}
class Engine {
  constructor(power) {
    this.power = power;
    this.heat = 0;
  }
  get hot() {
    return this.heat > 20;
  }
  set hot(value) {
    this.heat = value ? 50 : 0;
  }
}
class Car {
  constructor(power) {
    this.engine = new Engine(power);
    this.radio = { channel: 3 };
  }
}
handing(Car.prototype, "engine", ["power", "heat", "hot"]);
handing(Car.prototype, "radio", ["channel"]);
function drive(car, times) {
  let sum = 0;
  for (let turn = 0; turn < times; turn++) {
    car.heat += car.power;
    if (car.hot) car.hot = false;
    car.channel = (car.channel + turn) % 9;
    sum += car.heat + car.channel;
  }
  return sum;
}
const car = new Car(7);
const other = new Car(3);
for (let round = 0; round < 30; round++) {
  const sum = drive(car, 10) + drive(other, 5);
  if (round % 12 === 0) console.log(round, sum, car.hot);
}
const texts = [
  "car.engine = { power: 1, heat: 2, hot: 'never' }",
  "Object.defineProperty(car.engine, 'heat', { get: () => 30, set(v) { car.radio.channel = v % 5; } })",
  "other.radio = Object.create({ channel: 8 })",
  "Object.defineProperty(Engine.prototype, 'hot', { get() { return this.heat % 2; }, set(v) { this.heat += 10; }, configurable: true })",
  "Object.defineProperty(Car.prototype, 'power', { get: () => 5, configurable: true })",
  "Object.defineProperty(other, 'channel', { value: 100, writable: true })",
  "delete Car.prototype.heat; car.heat = 4; other.heat = 6",
  "car.radio = null",
  "Object.freeze(other.engine)",
];
for (const text of texts) {
  let word;
  try {
    eval(text);
    word = drive(car, 4) + "," + drive(other, 4);
  } catch (error) {
    word = error.constructor.name + " " + String(other.heat);
  }
  console.log(word);
}
eval("handing(Car.prototype, 'trunk', ['bags']); other.trunk = { bags: 2 }");
console.log(other.bags, (other.bags = 5), other.trunk.bags, new Function("car", "return typeof car.bags === 'undefined'")(other));
