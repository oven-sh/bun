class Tally {
  constructor(step) {
    this.count += step;
    this.count = "first";
    this.count = step;
    this.count += step;
    this.other = step;
    this.other += "y";
  }
}
const tally = new Tally(2);
console.log(tally.count, typeof tally.count, tally.other, typeof tally.other);
