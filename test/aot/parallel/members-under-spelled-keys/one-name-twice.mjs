// Two members of one class come to one key: the later is there.
const text = "twice", mark = Symbol("mark"), again = mark;
class Pair {
  twice() { return "written"; }
  [text]() { return "computed"; }
  [mark]() { return "first"; }
  [again]() { return "second"; }
  get half() { return "getter written"; }
  set ["half"](value) { this.kept = value; }
  get [Symbol.for("shared")]() { return "registered first"; }
  [Symbol.for("shared")]() { return "registered method"; }
  ["constructor"]() { return "a method named constructor"; }
  static ["name"]() { return "a static method named name"; }
  static [mark]() { return "static"; }
}
class Late extends Pair {
  [text]() { return "late " + super[text](); }
  twice() { return "latest " + super.twice(); }
}
function ask(list) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const said = [];
  for (let i = 0; i < list.length; i++) {
    const one = list[i];
    one.half = i;
    const line = [one.twice(), one[text](), one[mark](), one.half, one.kept, one[Symbol.for("shared")](), one instanceof Late ? one.constructor === Late : one.constructor(), Pair.name(), Pair[mark]()].join("|");
    if (!said.includes(line)) said.push(line);
  }
  return said.length + " " + said[0] + " " + said[said.length - 1] + work;
}
const list = [];
for (let i = 0; i < 400; i++) list.push(i % 3 ? new Pair() : new Late());
console.log(ask(list));
console.log(Reflect.ownKeys(Pair.prototype).map(String).join(), Reflect.ownKeys(Pair).map(String).join());
console.log(Pair.prototype[mark].name, Pair.prototype[text].name, Object.getOwnPropertyDescriptor(Pair.prototype, "half").set.name);
