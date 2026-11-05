const parse = text => JSON.parse(process.argv.length > 90 ? "{}" : text);
const box = parse('{"first": 1, "second": "two", "nested": {"third": 3}}');
const proto = parse('{"inherited": "from above"}');
const heir = Object.create(proto);
Object.defineProperty(proto, "computed", { get() { return this.own + " and computed"; }, set(value) { this.seen = value; }, configurable: true });
const frozen = Object.freeze(parse('{"fixed": 1}'));

const first = box.first;
const second = box.second;
const third = box.nested.third;
const missing = box.missing;
const inherited = heir.inherited;
box.added = first + third;
box.first = 10;
heir.own = "of its own";
heir.computed = "through the setter";
const literal = { __proto__: proto, listed: box.added };
console.log(first, second, third, missing, inherited, box.added, box.first, heir.own, heir.computed, heir.seen, literal.listed, literal.inherited);
console.log(Object.keys(box).join(), Object.keys(heir).join(), Object.keys(literal).join());
console.log("text".length, (5).toFixed, [1, 2].length, parse.name, parse.length);

try {
  frozen.fixed = 2;
} catch (error) {
  console.log(error.constructor.name, frozen.fixed);
}
try {
  parse("null").anything;
} catch (error) {
  console.log(error.constructor.name);
}
try {
  parse("null").anything = 1;
} catch (error) {
  console.log(error.constructor.name);
}

const boxes = [];
for (let i = 0; i < 300; i++) boxes.push(parse('{"first": ' + i + ', "second": "two"}'));
let sum = 0;
for (let i = 0; i < boxes.length; i++) {
  sum += boxes[i].first;
  boxes[i].second = i;
}
console.log(sum, boxes[299].second);
