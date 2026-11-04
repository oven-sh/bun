// The keys of an instance that got them in another order than its class declares are seen by Object.keys of an instance of the class below.
// Under: --aot-testing=CheckProofsAtRunTime: LinkedLayout::keysMayBeListed
class Base {
  constructor(flip) {
    if (flip) {
      this.y = 2;
      this.x = 1;
    } else {
      this.x = 1;
      this.y = 2;
    }
  }
}
class Derived extends Base {
  constructor(flip) {
    super(flip);
    this.z = 3;
  }
}
function sum(o) {
  return o.x + o.y;
}
function deed(o) {
  return Object.keys(o).join();
}
console.log(sum(new Base(true)) + sum(new Derived(false)));
console.log(deed(new Derived(true)));
console.log(deed(new Derived(false)));
let last = "";
for (let i = 0; i < 300; i++) last = deed(new Derived(i % 2 === 0)) + "|" + deed(new Derived(i % 2 === 1));
console.log(last);
