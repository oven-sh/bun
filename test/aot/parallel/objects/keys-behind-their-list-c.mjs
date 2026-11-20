// An accessor under the name of undefined sees an object that is still being made, where the key lies behind the list.
const seen = [];
class Shelf {
  constructor(options) {
    this.size = 1;
    this[Object.keys(options)[0]] = 5;
    this.label = 2;
  }
  set undefined(value) {
    seen.push(Object.keys(this).join("+"), this.size, this.label, value);
    this.told = value;
  }
}
class Upper {
  set undefined(value) {
    seen.push("upper", this.label, value);
    Upper.last = this;
  }
}
class Lower extends Upper {
  constructor(options) {
    super();
    this.size = 1;
    this[Object.keys(options)[0]] = 6;
    this.label = 3;
  }
}
class Filled {
  label = 7;
  constructor(options) {
    this[Object.keys(options)[0]] = 8;
    this.size = 9;
  }
  get undefined() {
    return this.size;
  }
  set undefined(value) {
    seen.push("filled", this.size, value);
    this.size = value;
  }
}
function Old(options) {
  this.size = 1;
  this[Object.keys(options)[1]] = 2;
  this.label = 3;
}
Object.defineProperty(Old.prototype, "undefined", {
  configurable: true,
  set(value) {
    seen.push("old", this.label, value);
  },
});
for (let turn = 0; turn < 2; turn++)
  for (const options of [{ size: 0 }, { label: 0 }, { size: 0, label: 0 }, {}])
    for (const Made of [Shelf, Lower, Filled, Old]) {
      const made = new Made(options);
      console.log(turn, Made.name, JSON.stringify(made), made.undefined, seen.splice(0).join());
    }
console.log(Upper.last instanceof Lower, Upper.last.label);
