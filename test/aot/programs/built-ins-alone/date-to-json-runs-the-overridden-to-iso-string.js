class Stamp extends Date {
  toISOString() {
    console.log("toISOString");
    return "stamp";
  }
}
console.log(new Stamp(0).toJSON(), JSON.stringify(new Stamp(0)));
