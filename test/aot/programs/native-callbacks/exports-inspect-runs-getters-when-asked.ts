// Exports of start-up modules: util.inspect with { getters: true } runs accessors of an object that the program never reads by name, own ones and, for a class, none of the prototype's.
import { inspect } from "node:util";

let runs = 0;

class Meter {
  base = 5;
  get reading(): number {
    runs += 1000;
    return this.base * 2;
  }
}

const meter = new Meter();
Object.defineProperty(meter, "own", {
  enumerable: true,
  get(this: Meter): number {
    runs += typeof this.base === "number" ? 1 : 100;
    return this.base + 1;
  },
  set(this: Meter, value: number) {
    runs += 1000000;
    this.base = value;
  },
});
const literal = {
  step: 3,
  get next(): number {
    runs += 10;
    return this.step + 1;
  },
};

const text = inspect(meter, { getters: true }) + inspect(literal, { getters: "get" }) + inspect(literal, { getters: "set" }) + inspect(literal);
console.log(runs, text.length);
