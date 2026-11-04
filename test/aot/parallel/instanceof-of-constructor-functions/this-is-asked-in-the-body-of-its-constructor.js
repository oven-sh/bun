// A function asks `this instanceof` itself in its body, so that it may be called without `new`, and one lays `this` below another object in front of the question.
function V(x) {
  if (!(this instanceof V)) return new V(x);
  this.x = x;
}
function Shifty(to) {
  Object.setPrototypeOf(this, to);
  this.was = this instanceof Shifty;
}

function deed(i) {
  return (i & 1 ? V(i) : new V(i)).x;
}
console.log(String(deed(1)), String(deed(2)), String(V.call({}, 3).x), String(V.call(new V(0), 4)), String(V.call(Object.create(V.prototype), 5)));
let sum = 0;
for (let i = 0; i < 200; i++) sum += deed(i);
console.log(String(sum));
console.log(String(new Shifty(null).was), String(new Shifty(Shifty.prototype).was), String(new Shifty({ __proto__: Shifty.prototype }).was), String(new Shifty(V.prototype).was));
let count = 0;
for (let i = 0; i < 200; i++) count += new Shifty(i % 3 ? Shifty.prototype : null).was ? 1 : 0;
console.log(String(count));
