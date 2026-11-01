// A loop calls a small function that reads a method of its argument: one object of the first of two classes that one class expression made, many of the second, then the first class again.
function make(tag) {
  return class Inner {
    constructor(d) {
      this.d = d;
    }
    tagOf() {
      return tag;
    }
  };
}
const A = make(1);
const B = make(2);

function tagOf(object) {
  return object.tagOf();
}
function total(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += tagOf(list[i]);
  return sum;
}
const first = [];
for (let i = 0; i < 200; i++) first.push(new A(i));
console.log(total(first));
for (const many of [2, 5, 20, 80, 300, 600]) {
  const second = [new A(0)];
  for (let i = 0; i < many; i++) second.push(new B(i));
  for (let i = 0; i < 10; i++) second.push(new A(i));
  console.log(many, total(second));
}
