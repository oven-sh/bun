// `this.value = value` in a constructor, in a program that defines a setter for `value` on the prototype object above only behind the loop that makes the objects.
// Until that statement has run the store creates the field where it stands: it looks no name up, whether the statement stands in the module, in a function that is called once,
// or is Object.defineProperties. `Shut` has its accessor before its first object, and stores under that name in an arm that is not taken: its other stores look no name up either.
// COUNT: arrivals <= 400
function Parent() {}
function Child(value) {
  this.value = value;
  this.extra = 2;
}
Object.setPrototypeOf(Child.prototype, Parent.prototype);

class Base {}
class Derived extends Base {
  constructor(size) {
    super();
    this.size = size;
    this.extra = 3;
  }
}

function Open() {}
Object.defineProperty(Open.prototype, "open", {
  get() {
    return this.state !== 0;
  },
  set(given) {
    this.state = given ? 1 : 0;
  },
  configurable: true,
});
function Shut(options) {
  this.state = 1;
  this.extra = 4;
  if (options && options.open === false) this.open = false;
}
Object.setPrototypeOf(Shut.prototype, Open.prototype);

const kept = [];
function sumOf(rounds, options) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) {
    const child = new Child(round & 7);
    const derived = new Derived(round & 3);
    const shut = new Shut(options);
    if ((round & 1023) === 0) kept.push(child, derived, shut);
    sum += child.value + child.extra + derived.size + derived.extra + shut.state + shut.extra;
  }
  return sum;
}

let taken = 0;
function install() {
  Object.defineProperties(Base.prototype, {
    size: {
      set(given) {
        taken += given * 10;
      },
      configurable: true,
    },
  });
}

console.log(sumOf(3000, process.argv.length > 9 ? { open: false } : undefined));
Object.defineProperty(Parent.prototype, "value", {
  set(given) {
    taken += given;
  },
  configurable: true,
});
install();
console.log(String(sumOf(8, { open: false })), taken);
console.log(kept.map(object => Object.keys(object).join()).join(" "));
console.log(kept.map(object => String(object.value ?? object.size ?? object.open)).join(" "));
delete Parent.prototype.value;
delete Base.prototype.size;
console.log(sumOf(8, undefined), taken, Object.keys(new Child(1)).join(), Object.keys(new Derived(1)).join());
