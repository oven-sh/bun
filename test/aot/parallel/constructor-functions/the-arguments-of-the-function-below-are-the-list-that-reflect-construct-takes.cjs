// `Reflect.construct(A, arguments, B)`: what compilers emit for a constructor that a class did not write itself.
// The function above gets as many arguments as the function below got, with what the program has stored into the object since. This file is sloppy: a parameter and its element are one.
function Named(x, y) { this.x = x; this.y = y; }
function Counts() { this.n = arguments.length; this.last = arguments[arguments.length - 1]; }
function Rest(first, ...others) { this.first = first; this.others = others.join(); }

function below(above, body) {
  const made = body(above);
  made.prototype = Object.create(above.prototype, { constructor: { value: made, writable: true, configurable: true } });
  Object.setPrototypeOf(made, above);
  return made;
}
const sloppy = above => { function B(a) { return Reflect.construct(above, arguments, B); } return B; };
const strict = above => { function B(a) { "use strict"; return Reflect.construct(above, arguments, B); } return B; };
const strictTwo = above => { function B(a, b) { "use strict"; return Reflect.construct(above, arguments, B); } return B; };
const strictNone = above => { function B() { "use strict"; return Reflect.construct(above, arguments, B); } return B; };
const parameterStored = above => { function B(a) { a = "stored"; return Reflect.construct(above, arguments, B); } return B; };
const parameterStoredStrict = above => { function B(a) { "use strict"; a = "stored"; return Reflect.construct(above, arguments, B); } return B; };
const elementStored = above => { function B(a) { "use strict"; arguments[0] = "element"; return Reflect.construct(above, arguments, B); } return B; };
const elementAdded = above => { function B(a) { "use strict"; arguments[1] = "added"; return Reflect.construct(above, arguments, B); } return B; };
const lengthStored = above => { function B(a) { "use strict"; arguments.length = 0; return Reflect.construct(above, arguments, B); } return B; };
const lengthRaised = above => { function B(a) { "use strict"; arguments.length = 3; return Reflect.construct(above, arguments, B); } return B; };

const bodies = { sloppy, strict, strictTwo, strictNone, parameterStored, parameterStoredStrict, elementStored, elementAdded, lengthStored, lengthRaised };
for (const above of [Named, Counts, Rest]) {
  for (const [name, body] of Object.entries(bodies)) {
    const B = below(above, body);
    const lines = [];
    for (let i = 0; i < 400; i++) {
      const made = [new B(), new B(7), new B(7, "two"), new B(7, "two", "three"), new B(undefined, undefined)];
      if (i === 0 || i === 399) lines.push(made.map(v => JSON.stringify(v) + (v instanceof B ? "" : " NOT B")).join(" "));
    }
    console.log(above.name, name, lines[0] === lines[1] ? "" : "THE LAST TURN DIFFERS " + lines[1], lines[0]);
  }
}

// One function each, written out, in a loop that gets hot.
function A(x) { this.z = x; }
A.prototype.base = function () { return this.z; };
function C(a) { "use strict"; var self = Reflect.construct(A, arguments, C); self.a = a; return self; }
C.prototype = Object.create(A.prototype, { constructor: { value: C, writable: true, configurable: true } });
function many(n) {
  let sum = 0, missing = 0;
  for (let i = 0; i < n; i++) {
    const v = new C(i & 7);
    sum += v.a + v.base();
    if (new C().base() === undefined) missing++;
  }
  return sum + " " + missing;
}
console.log(many(3000));
