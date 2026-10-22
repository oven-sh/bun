class Base {
  size() {
    return 1.5;
  }
}
console.log(Object.getPrototypeOf(new Base()).size() + 1, Object.getPrototypeOf(Object.create(null)) === null, Object.getPrototypeOf(Object.prototype) === null);
