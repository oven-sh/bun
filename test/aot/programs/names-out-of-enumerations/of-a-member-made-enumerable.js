// The constructor property of a function and of a class, and a hidden property of an object of the program, are made enumerable. Nothing is written: only the attribute changes.
function Legacy() { this.own = 1; }
class Modern { own = 1; }
Object.defineProperty(Legacy.prototype, "constructor", { enumerable: true });
Object.defineProperty(Modern.prototype, "constructor", { enumerable: true });
function list(o) {
  const found = [];
  for (const name in o) found.push(name, typeof o[name], o[name] === Legacy || o[name] === Modern);
  return found.join();
}
console.log(list(new Legacy()));
console.log(list(new Modern()));
const plainAbove = { shown: 1 };
Object.defineProperty(plainAbove, "hidden", { value: Legacy, enumerable: false, configurable: true });
const below = Object.create(plainAbove);
console.log(list(below));
Object.defineProperty(plainAbove, "hidden", { enumerable: true });
console.log(list(below));
