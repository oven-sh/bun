// A method that the program stores on the prototype when objects exist: the first store under its name brings another function.
function Jar() {
  this.lid = "tin";
  this.beans = [1, 2, 3];
}
function weigh(from, many) {
  let grams = 0;
  for (let place = from; place < from + many; place++) grams += this.beans[place] * 4;
  return grams;
}
function other(from, many) {
  return "other" + from + many;
}
refit = function (how) {
  Jar.prototype.tell = how;
};
const key = process.argv.length > 100 ? "x" : ["te", "ll"].join("");
const kept = [new Jar(), new Jar()];
function use() {
  let said = [];
  for (let k = 0; k < 40; k++) {
    try {
      said.push(kept[k & 1].tell(k % 3, 2));
    } catch (e) {
      said.push(e.constructor.name);
    }
  }
  console.log(said.join(" "));
}
use();
Reflect.set(Jar.prototype, key, other);
use();
refit(weigh);
use();
Object.defineProperty(Jar.prototype, key, { value: other, writable: true, configurable: true, enumerable: true });
use();
console.log(Object.keys(Jar.prototype).join(), typeof Jar.prototype.tell, new Jar().tell(0, 1));
