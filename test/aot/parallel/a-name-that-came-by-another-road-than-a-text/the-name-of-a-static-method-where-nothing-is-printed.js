// So does the name of a static method.
class Shelf {
  static constructor() {}
}
const key = Object.getOwnPropertyNames(Shelf)[3];
const pick = (holder, key) => holder[key];
