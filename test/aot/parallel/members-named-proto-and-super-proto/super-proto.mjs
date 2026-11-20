class Low { constructor() { this.kind = "low"; } }
class Mid extends Low { constructor() { super(); this.kind = "mid"; } }
class Top extends Mid {
  own() { return 1; }
  probe() {
    let work = 0;
    for (let i = 0; i < 2; i++) work = (work + i) | 0;
    return super.__proto__.own;
  }
  static make() {
    let work = 0;
    for (let i = 0; i < 2; i++) work = (work + i) | 0;
    const Above = super.__proto__;
    return new Above().kind;
  }
}
const top = new Top();
console.log(typeof top.probe(), Top.make());
