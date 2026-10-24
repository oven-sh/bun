function read(o) {
  return o.a + o.b;
}

const literal = { a: 1, b: 2, set a(v) {} };
console.log(read(literal), typeof literal.a);

const later = { a: 1, b: 2 };
later.__defineSetter__("a", () => {});
console.log(read(later), typeof later.a);

function make(n) {
  return { a: n, b: 2 };
}
const list = [make(1), make(2), make(3)];
list[1].__defineSetter__("a", () => {});
console.log(list.map(read).join());

const holder = { a: 1.5, b: { x: 1 } };
holder.__defineSetter__("b", () => {});
try {
  console.log(holder.b.x);
} catch (e) {
  console.log("threw", e instanceof TypeError);
}

const both = { a: 1, b: 2 };
both.__defineGetter__("a", () => "g");
both.__defineSetter__("a", () => {});
console.log(read(both), typeof both.a);
