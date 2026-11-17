// The rest of a value is a new object, whatever the value is: an instance of a class that arrives there keeps its properties, and other code may go on reading them by their place.
class Builder {
  config;
  list = [];
  constructor(name) {
    this.config = { name, notNull: false, value: undefined, count: 0 };
  }
  identity(sequence) {
    if (sequence) {
      const { name, ...options } = sequence;
      this.config.value = { name, options };
    }
    return this;
  }
  build() {
    this.config.count = this.config.count + 1;
    return this.config.name.length + this.config.count;
  }
}
class Named {
  name = "named";
  size = 3;
  get area() {
    return this.size * this.size;
  }
}
const show = value => JSON.stringify(value, (_, held) => (held === undefined ? "undefined" : held));
const builders = [new Builder("id"), new Builder("text")];
const unknown = JSON.parse('{"method":"identity","name":"given","other":[1]}');
let total = 0;
for (let k = 0; k < 1000; k++) {
  const builder = builders[k & 1];
  total += builder.build();
  if (k % 250 === 249) {
    builder[unknown.method](k & 2 ? builders[0] : unknown);
    console.log(Object.keys(builder.config.value.options).join(), builder.config.value.name, builders[0].config.name, builders[0].list.length);
  }
}
console.log(total);

function without(value) {
  const { name, ...rest } = value;
  return rest;
}
function withoutTwo({ name, size, ...rest }) {
  return [name, size, rest];
}
function withoutComputed(value, key) {
  const { [key]: held, ...rest } = value;
  return [held, rest];
}
const named = new Named();
const literal = { name: "literal", size: 1, deep: { name: "inner" } };
const frozen = Object.freeze({ name: "frozen", size: 2 });
const getter = { get name() { return "got"; }, set name(value) {}, size: 4 };
for (const value of [named, literal, frozen, getter, [1, 2], "text", 5, () => 1, new Map(), Object.create({ name: "above" }), Object.assign(Object.create(null), { name: 1, x: 2 }), new Proxy({ name: "p", q: 1 }, {})]) {
  for (let k = 0; k < 40; k++) without(value);
  const rest = without(value);
  console.log(show(rest), rest.name, "name" in rest, Object.getPrototypeOf(rest) === Object.prototype, rest instanceof Named, show(withoutTwo(value)), show(withoutComputed(value, "size")));
  rest.name = "new";
  rest.more = 1;
  delete rest.size;
  console.log(show(rest), Object.keys(rest).join());
}
console.log(named.name, named.size, named.area, show(named), literal.name, literal.deep.name, show(literal), frozen.name, getter.name, show(getter));
for (const value of [null, undefined]) {
  try {
    without(value);
  } catch (error) {
    console.log(error.name);
  }
}
const copy = without(named);
console.log(copy.size, copy.area, Object.keys(copy).length, show({ ...copy, name: "again" }), show({ ...named, name: undefined }));
let size = 0;
for (let k = 0; k < 2000; k++) {
  const { name, ...rest } = k % 3 ? new Named() : { name: k, size: 1, k };
  size += rest.size + (rest.name === undefined ? 1 : 0) + (rest.k ?? 0);
}
console.log(size);
