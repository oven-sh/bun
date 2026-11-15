class Tally {
  static {
    Tally.count += 1;
    Tally.count = "of the class";
  }
  constructor() {
    this.count += 1;
  }
}
Tally.prototype.count = 10;
class Other {
  static {
    Other.count = "of the class";
  }
  constructor() {
    this.count += 1;
    this.count = [this.count];
  }
}
const tally = new Tally();
console.log(Tally.count, tally.count, Object.keys(tally).join(), Other.count, String(new Other().count[0]));
