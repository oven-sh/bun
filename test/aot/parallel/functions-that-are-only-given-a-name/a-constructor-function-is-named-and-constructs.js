function giveName(named, text) {
  Object.defineProperty(named, "name", { value: text, enumerable: false, configurable: true });
}
function Maker() { this.made = 1; }
Maker.prototype.tell = function () { return this.made + 1; };
function other() {}
giveName(Maker, "Named");
giveName(other, "two");
console.log(Maker.name, other.name, new Maker().tell(), new Maker().constructor.name);
