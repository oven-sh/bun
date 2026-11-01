// The same helper called plainly, through call and apply, as a method, through a variable that changes, and handed what no name says.
function inherits(Below, Above) {
  Below.prototype = new Above();
}
function Base() { this.from = "Base"; }
function Second() { this.from = "Second"; }
const pick = flag => (flag ? Base : Second);
const holder = { inherits };
let changing = inherits;
function A() {} function B() {} function C() {} function D() {} function E() {} function F() {} function G() {} function H() {}
inherits(A, Base);
inherits.call(null, B, Second);
inherits.apply(null, [C, Base]);
holder.inherits(D, Second);
changing(E, Base);
changing = function (Below) { Below.prototype = { from: "changed" }; };
changing(F, Base);
inherits(G, pick(process.argv.length > 100));
inherits(H, class { from = "a class"; });
let said = "nothing";
try { inherits(A); } catch (error) { said = error.constructor.name + ": " + error.message; }
let alsoSaid = "nothing";
try { inherits(A, 5); } catch (error) { alsoSaid = error.constructor.name + ": " + error.message; }
console.log(new A().from, new B().from, new C().from, new D().from, new E().from, new F().from, new G().from, new H().from);
console.log(said, "|", alsoSaid);
