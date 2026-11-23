const unseen = (x) => [x][JSON.parse("0")];
function Animal(n) { this.n = n; }
Animal.create = function (n) { return new this(n); };
function Dog(n) { Animal.call(this, n + 1); }
Dog.prototype = Object.create(Animal.prototype);
Dog.prototype.constructor = Dog;
Object.setPrototypeOf(Dog, Animal);
function run(count, key, holder) {
  let sum = 0, reads = 0;
  for (let i = 0; i < count; i++) {
    sum += Dog.create(i).n;
    if (i === 4) Object.defineProperty(holder, key, { configurable: true, get() { reads++; return function (n) { return { n: 1000 }; }; } });
  }
  return sum + " " + reads;
}
console.log(run(10, unseen("create"), unseen(Animal)));
