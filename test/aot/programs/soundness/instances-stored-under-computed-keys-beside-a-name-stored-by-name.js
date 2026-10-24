// One instance of a class gets a name by a direct store, others get it under keys that only the run knows, with another type. Methods read the name and a field of the constructor from all of them.
const names = JSON.parse('["late", "size"]');
const input = JSON.parse('{"late": 5, "size": "big"}');
class Record {
  constructor(i) {
    this.x = i;
    this.size = i + 1;
  }
  lateLength() {
    return this.late.length;
  }
  sizePlusOne() {
    return this.size + 1;
  }
}
const first = new Record(1);
first[names[0]] = 5;
const second = new Record(2);
second.late = "text";
const third = new Record(3);
for (const k of Object.keys(input)) third[k] = input[k];
const fourth = Object.assign(new Record(4), input);
let out = [];
for (const o of [first, second, third, fourth]) out.push(o.lateLength(), o.sizePlusOne(), Object.keys(o).join("+"), JSON.stringify(o));
console.log(out.join(" | "));
let total = 0;
for (let i = 0; i < 10000; i++) {
  const o = i % 4 === 0 ? first : i % 4 === 1 ? second : i % 4 === 2 ? third : fourth;
  const length = o.lateLength();
  total += length === undefined ? 1 : length;
  const size = o.sizePlusOne();
  total += typeof size === "number" ? size : size.length;
}
console.log(total);
