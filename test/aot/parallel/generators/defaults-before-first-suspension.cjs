// COUNTER: operationAOTTakeGeneratorPrototype <= 60
// A generator takes its function's prototype again only where a default or a pattern in front of its first suspension may have run code that replaces it.
const out = [];
const say = (...values) => out.push(values.map(String).join(" "));
const unknown = process.argv[99];
function* constants(a, b = 1, c = "x", d = b) {
  yield a;
  yield b + c + d;
}
function* chosen(a, b = unknown === undefined ? 1 : 2, c = !b, d = typeof a, e = a === b) {
  yield [a, b, c, d, e].join();
}
class Tokens {
  constructor() {
    this.list = [1, 2, 3];
  }
  *each(from = 0, lenient = false) {
    for (let i = from; i < this.list.length; i++) yield lenient ? -this.list[i] : this.list[i];
  }
  static *both(first, second = first) {
    yield first;
    yield second;
  }
}
const tokens = new Tokens();
const keep = [];
function take(iterator) {
  let sum = "";
  for (;;) {
    const step = iterator.next();
    if (step.done) return sum;
    sum += step.value + ";";
  }
}
for (let i = 0; i < 100; i++) {
  const all = [constants(i), constants(i, 2), constants(i, 2, "y"), chosen(i), chosen(i, 3), tokens.each(), tokens.each(1, true), Tokens.both(i), Tokens.both(i, 7)];
  if (i % 33 === 0) {
    for (const one of all) say(take(one));
    say(Object.getPrototypeOf(all[0]) === constants.prototype, Object.getPrototypeOf(all[5]) === Object.getPrototypeOf(all[6]), all[0] instanceof constants, all[3] instanceof chosen, all[1] instanceof chosen);
  }
  keep.push(all[i % all.length]);
}
// What runs in front of the first suspension and replaces the prototype.
const other = Object.create(Object.getPrototypeOf(function* () {}.prototype), { own: { value: "other" } });
function* replaced(a = ((replaced.prototype = other), 1)) {
  yield a;
}
const before = replaced.prototype;
say(Object.getPrototypeOf(replaced(5)) === before, Object.getPrototypeOf(replaced()) === other, replaced().own, replaced(3).own);
function* called(a = helper(), b = 2) {
  yield a + b;
}
let answers = 0;
function helper() {
  if (++answers === 2) called.prototype = other;
  return answers;
}
say(called().own, called().own, called(1).own, take(called(1, 1)));
function* read({ x } = {}, y = x) {
  yield x + y;
}
const trap = {
  get x() {
    read.prototype = other;
    return 4;
  },
};
say(read({ x: 1 }).own, read(trap).own, read().own);
function* valued(a = +box, b = 1) {
  yield a + b;
}
const box = {
  valueOf() {
    valued.prototype = other;
    return 6;
  },
};
say(valued(1).own, valued().own, valued(1).own);
function* thrown(a = missing()) {
  yield a;
}
for (let i = 0; i < 2; i++) {
  try {
    thrown();
    say("made");
  } catch (error) {
    say(error.name);
  }
}
say(thrown(1) instanceof thrown);
constants.prototype = null;
say(Object.getPrototypeOf(constants(1)) === Object.getPrototypeOf(function* () {}.prototype), take(constants(1)));
constants.prototype = other;
say(constants(1).own, constants(1, 2).own, constants(1) instanceof constants, keep[0] instanceof constants);
Reflect.defineProperty(Tokens.prototype.each, "prototype", { value: other });
say(tokens.each().own, tokens.each(1).own);
console.log(out.join("\n"));
