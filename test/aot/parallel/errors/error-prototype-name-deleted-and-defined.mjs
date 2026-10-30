console.log(delete TypeError.prototype.name, new TypeError("t").name, String(new TypeError("t")));
Object.defineProperty(Error.prototype, "name", {
  get() {
    return "Got " + this.message;
  },
  configurable: true,
});
console.log(new Error("m").name, new TypeError("n").name, new RangeError("o").name);
console.log(Reflect.deleteProperty(Error.prototype, "name"), new Error("m").name, String(new Error("m")));
