function Old(x, y) {
  this.x = x;
  this.y = y;
}
function Child(x, y) {
  Old.call(this, x, y);
  this.z = 3;
}
Child.prototype = Object.create(Old.prototype);
Child.prototype.constructor = Child;
function Wide(a) {
  this.a = a;
  this.b = a + 1;
  this.c = a + 2;
  this.d = a + 3;
}
function Forwards(x, y) {
  return Reflect.construct(Old, [x, y], new.target);
}
class Klass {
  k = 40;
  l = 50;
}
class FromOld extends Old {
  constructor(x, y) {
    super(x, y);
    this.w = 9;
  }
}
let sum = 0;
function n(value) {
  return value === undefined ? 0 : value;
}
function note(made, target) {
  sum = (sum * 19 + Object.keys(made).length * 100000 + n(made.x) * 7 + n(made.y) * 11 + n(made.z) * 13 + n(made.a) * 17 + n(made.b) * 23 + n(made.c) * 29 + n(made.d) * 31 + n(made.k) * 37 + n(made.l) * 41 + n(made.w) * 43 + (Object.getPrototypeOf(made) === target.prototype ? 1 : 0)) % 1000003;
}
const bound = Old.bind(null, 5);
for (let i = 1; i < 4; i++) {
  note(Reflect.construct(Child, [i, 2], Old), Old);
  note(Reflect.construct(Old, [i, 2], Child), Child);
  note(Reflect.construct(Old, [i, 2], Wide), Wide);
  note(Reflect.construct(Wide, [i], Old), Old);
  note(Reflect.construct(Wide, [i], Klass), Klass);
  note(Reflect.construct(Klass, [], Wide), Wide);
  note(Reflect.construct(FromOld, [i, 2], Wide), Wide);
  note(Reflect.construct(FromOld, [i, 2], Klass), Klass);
  note(Reflect.construct(Old, [i, 2], FromOld), FromOld);
  note(Reflect.construct(Wide, [i], FromOld), FromOld);
  note(Reflect.construct(bound, [i], Wide), Wide);
  note(new bound(i), Old);
  note(new Forwards(i, 2), Forwards);
  note(Reflect.construct(Forwards, [i, 2], Wide), Wide);
  note(new Old(i, 2), Old);
  note(new Child(i, 2), Child);
  note(new Wide(i), Wide);
  note(new Klass(), Klass);
  note(new FromOld(i, 2), FromOld);
}
console.log(sum);
