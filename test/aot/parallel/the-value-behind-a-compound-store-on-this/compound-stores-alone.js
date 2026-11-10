class Tally {
  constructor(step) {
    this.count += step;
    this.label += "x";
    this.shift <<= 1;
  }
}
const tally = new Tally(2);
console.log(String(tally.count), tally.label, tally.shift, Object.keys(tally).join());
