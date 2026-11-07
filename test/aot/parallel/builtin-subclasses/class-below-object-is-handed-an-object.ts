// `class Below extends Object`: `super(value)` makes a new object of the class and does not answer the value, as `new Object(value)` and `Object(value)` do.
class Below extends Object {
  tag: number;
  constructor(value: object, tag: number) {
    super(value);
    this.tag = tag;
  }
}
const given = { given: true };
let same = 0;
let sum = 0;
for (let i = 0; i < 300; i++) {
  const made = new Below(given, i);
  if ((made as object) === given) same++;
  sum += made.tag;
  const reflected = Reflect.construct(Object, [given], Below) as Below;
  if ((reflected as object) === given) same++;
  if (reflected instanceof Below) sum++;
}
console.log(same, sum, new Object(given) === given, Object(given) === given);
