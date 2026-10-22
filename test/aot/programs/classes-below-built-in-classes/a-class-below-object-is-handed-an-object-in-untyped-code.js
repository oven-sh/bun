// `class Below extends Object` in plain JavaScript: `super(value)` makes a new object of the class and does not answer the value. The field of the class is stored and read behind it.
class Below extends Object {
  tag;
  constructor(value, tag) {
    super(value);
    this.tag = tag;
  }
}
const given = { given: true };
let sum = 0;
for (let i = 0; i < 300; i++) {
  const made = new Below(given, i);
  sum += made.tag;
}
console.log(sum);
