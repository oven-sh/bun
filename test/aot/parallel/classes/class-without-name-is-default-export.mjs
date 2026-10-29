// The default export of this module is a class declaration without a name. The module imports itself and prints what the class is called and what it makes.
import * as self from "./class-without-name-is-default-export.mjs";

export default class {
  static made = 0;
  value = 1;
  constructor() {
    this.constructor.made++;
  }
  double() {
    return this.value * 2;
  }
}

const Class = self.default;
console.log(typeof Class, JSON.stringify(Class.name));
console.log(new Class().double(), new Class().value, Class.made);
console.log(Object.keys(self).join());
