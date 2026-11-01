function make(tag) {
  return class Inner {
    constructor(d) { this.d = d; }
    tagOf() { return tag; }
  };
}
const A = make(1), B = make(2);
function total(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i].tagOf();
  return sum;
}
const first = [];
for (let i = 0; i < 200; i++) first.push(new A(i));
const second = [new A(0)];
for (let i = 0; i < 600; i++) second.push(new B(i));
for (let i = 0; i < 10; i++) second.push(new A(i));
console.log(total(first), total(second));
