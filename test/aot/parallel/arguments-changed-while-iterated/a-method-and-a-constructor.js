class Holder {
  constructor() {
    this.seen = [];
    for (const value of arguments) {
      arguments[1] = "Y";
      this.seen.push(value);
    }
  }
  again() {
    const seen = [];
    for (const value of arguments) {
      arguments.length = 2;
      seen.push(value);
    }
    return seen.join();
  }
  static plain() {
    let text = "";
    for (const value of arguments) text += value;
    return text;
  }
}
const holder = new Holder("a", "b", "c");
console.log(holder.seen.join(), holder.again("a", "b", "c"), Holder.plain("a", "b", "c"));
