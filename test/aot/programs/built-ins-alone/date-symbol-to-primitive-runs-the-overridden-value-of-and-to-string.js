class Stamp extends Date {
  valueOf() {
    console.log("valueOf");
    return 1.5;
  }
  toString() {
    console.log("toString");
    return "stamp";
  }
}
console.log(new Stamp(0) - 1, new Stamp(0) + 1, `${new Stamp(0)}`);
