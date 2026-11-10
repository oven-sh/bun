// The answer of the read is only looked at: no built-in under the name leaves, and the library behind them stays out of the image.
// STATISTIC: ImageFunctionsEmitted <= 10
class Holder {
  held: any;
  constructor(held: any) {
    this.held = held;
  }
  kind(): string {
    return typeof this.held;
  }
}
const holders = [new Holder(JSON.parse("{}").constructor), new Holder(JSON.parse('{"constructor":"text"}').constructor)];
console.log(holders.map(holder => holder.kind()).join(" "));
