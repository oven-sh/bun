// The prototype of a constructor function is asked through a proxy that stands as new.target: the trap runs, the function is entered by native code.
function Pair(a, b) {
  this.a = a;
  this.b = b;
}
let asked = 0;
const watched = new Proxy(Pair, {
  get(target, key, receiver) {
    if (key === "prototype") asked++;
    return Reflect.get(target, key, receiver);
  },
});
let total = 0;
for (let i = 0; i < 5; i++) total += new Pair(i, 1).a;
const made = Reflect.construct(Pair, [7, 8], watched);
const other = new watched(9, 10);
console.log(total, made.a, other.b, asked, made instanceof Pair);
