// A field that some instances have over a method of their class: an empty one leaves the read to the method, which nothing calls.
class A {
  count = 2;
  size(x) {
    return this.count;
  }
  name(x) {
    return this.count + 1;
  }
}
function work(all) {
  let total = 0;
  for (const one of all) if (one.size === one.size) total += 1;
  return total;
}
const o = new A();
o.size = A.prototype.name;
console.log(work([o]), work([o, new A()]));
