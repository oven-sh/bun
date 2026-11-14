// A method that the program stores on the prototype when objects exist: the first store under its name brings another function.
function Big() {
  this.array = [1, 2, 3];
  this.t = 3;
}
function am(i, n) {
  var a = this.array,
    s = 0;
  while (--n >= 0) s += a[i++];
  return s;
}
function other(i, n) {
  return "other" + i + n;
}
setup = function (f) {
  Big.prototype.am = f;
};
const key = process.argv.length > 100 ? "x" : ["a", "m"].join("");
const kept = [new Big(), new Big()];
function use() {
  let said = [];
  for (let k = 0; k < 40; k++) {
    try {
      said.push(kept[k & 1].am(k % 3, 2));
    } catch (e) {
      said.push(e.constructor.name);
    }
  }
  console.log(said.join(" "));
}
use();
Reflect.set(Big.prototype, key, other);
use();
setup(am);
use();
Object.defineProperty(Big.prototype, key, { value: other, writable: true, configurable: true, enumerable: true });
use();
console.log(Object.keys(Big.prototype).join(), typeof Big.prototype.am, new Big().am(0, 1));
