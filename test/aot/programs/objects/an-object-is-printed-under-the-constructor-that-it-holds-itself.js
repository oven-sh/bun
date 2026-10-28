// An object is printed under the name of the function that it holds itself as `constructor`, before that of the one it inherits.
function Maker() {}
class Declared {
  method() {}
}
class Heir extends Declared {}
const nameOf = value => Bun.inspect(value).split(" ")[0];

const literal = { constructor: Maker, payload: 1 };
console.log(nameOf(literal));
console.log(nameOf({ __proto__: null, constructor: Maker, payload: 1 }));
console.log(nameOf({ get constructor() { return Maker; }, payload: 1 }));
console.log(nameOf({ constructor: 1, payload: 1 }));
console.log(nameOf({ constructor: Declared, payload: 1 }));

const storedLater = { payload: 1 };
storedLater.constructor = Maker;
console.log(nameOf(storedLater));

class WithField {
  constructor() {
    Object.defineProperty(this, "constructor", { value: Maker, enumerable: true });
    this.payload = 1;
  }
}
console.log(nameOf(new WithField()));
console.log(nameOf(Declared.prototype), nameOf(Heir.prototype), nameOf(new Heir()));
