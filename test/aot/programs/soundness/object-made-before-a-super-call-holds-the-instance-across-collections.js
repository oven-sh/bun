function F() {}
function T() {}
T.prototype = Object.create(F.prototype);
const keep = [];
class B extends F {
  constructor(i) {
    const owner = { child: null, i };
    super();
    owner.child = this;
    this.i = i;
    keep[i & 1023] = owner;
  }
}
for (let i = 0; i < 400000; i++) { if (i % 3) new B(i); else Reflect.construct(B, [i], T); }
let sum = 0;
for (const owner of keep) sum += owner.child.i - owner.i;
console.log(sum, keep.length);
