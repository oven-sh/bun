function passThrough(value) { return [value].flatMap(element => [element])[0]; }
const held = { c: 1 };
class C extends RegExp {
  constructor(a, b) { super(a, b); held.index = held.c; }
}
const made = passThrough(new C(",", ""));
console.log("a,b".split(made).join("|"), held.index);
