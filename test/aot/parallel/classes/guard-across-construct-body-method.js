// Flags: --aot-check=verify-each-pass
class Maker {
  make(i) {
    function Holder(o) { this.keep = o; }
    return [{ i }, { i: i + 1 }].map(o => new Holder(o));
  }
}
const maker = new Maker();
let sum = 0;
for (let i = 0; i < 500; i++) { const made = maker.make(i); sum += made[0].keep.i + made[1].keep.i; }
console.log(sum);
