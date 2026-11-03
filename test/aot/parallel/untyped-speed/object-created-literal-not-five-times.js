// Object.create() of a literal that holds a method and a getter, and a store of a field, beside a class that says the same. The method and the getter of both are found when the program is built.
// COUNT: arrivals <= 300
// COUNT: branches <= 5600
// COUNT: operations <= 300
// COUNT: cells <= 300
const above = {
  get() {
    return this.x;
  },
  get twice() {
    return this.x * 2;
  },
};
function create(x) {
  const created = Object.create(above);
  created.x = x;
  return created;
}
class Declared {
  constructor(x) {
    this.x = x;
  }
  get() {
    return this.x;
  }
  get twice() {
    return this.x * 2;
  }
}
const created = create(1),
  declared = new Declared(1);
function ofTheClass() {
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum = (sum + declared.get() + declared.twice + i) | 0;
  return sum;
}
function ofTheLiteral() {
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum = (sum + created.get() + created.twice + i) | 0;
  return sum;
}
console.log(ofTheClass(), ofTheLiteral(), Object.keys(created).join(), Object.getPrototypeOf(created) === above);
