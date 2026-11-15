let work = 0;
class Low { constructor() { for (let i = 0; i < 2; i++) work = (work + i) | 0; this.kind = "low"; } }
class Mid extends Low { constructor() { super(); for (let i = 0; i < 2; i++) work = (work + i) | 0; this.kind = "mid"; this.more = 1; } }
class Top extends Mid {
  static make() {
    for (let i = 0; i < 2; i++) work = (work + i) | 0;
    const Above = super.__proto__;
    const made = new Above();
    return made.kind + ":" + made.more + ":" + (made instanceof Mid);
  }
}
let out = ""; for (let i = 0; i < 300; i++) out = Top.make();
console.log(out);
