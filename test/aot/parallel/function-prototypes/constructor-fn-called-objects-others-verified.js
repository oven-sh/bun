// A constructor function that the program only calls with the objects of others: by Base.call(this) and by super(). Nobody writes `new Base()`, so its `this` never is an object of its own making.
// variant-verify-each-pass-1.test.ts always takes this program: there the IR is verified behind the pass that makes the entrypoints.
// Flags: --aot-check=verify-each-pass
const unseen = new Function("x", "return x");
function Base() {
  this.count = 0;
}
Base.prototype.bump = function () {
  this.count++;
  return this;
};
class Below extends Base {
  bump() {
    return super.bump().count + 100;
  }
}
function Used() {
  Base.call(this);
  this.extra = 1;
}
Object.setPrototypeOf(Used.prototype, Base.prototype);
unseen(Below);
unseen(Used);
let sum = 0;
for (let round = 0; round < 500; round++) sum += new Used().bump().count + new Below().bump();
console.log(sum, new Used() instanceof Base, new Below() instanceof Base);
