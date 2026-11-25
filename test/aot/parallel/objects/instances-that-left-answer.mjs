// A built-in object that left may answer conversions and calls with methods that were laid on it out of sight. Beside it, objects of a class and functions are converted and called too: what they hold stays what it was.
const log = [];
const names = ["valueOf", "toString", "clone", Symbol.toPrimitive, "toJSON"];
class Moment {
  constructor(value) {
    this.value = value;
    this.calls = 0;
  }
  valueOf() {
    this.calls++;
    return this.value;
  }
  toString() {
    return "m" + this.value;
  }
  clone() {
    return new Moment(this.value + 1);
  }
  sum() {
    return this.value + this.calls;
  }
}
const all = [];
for (let i = 0; i < 4; i++) all.push(new Moment(i));
function total() {
  let sum = 0;
  for (let i = 0; i < all.length; i++) sum += typeof all[i].value === "number" ? all[i].value * 10 + all[i].calls : 1;
  return sum;
}
const answers = [
  () => function () { return 40; },
  i => function () { all[i % 4].value = all[i % 4].value + 100; return "w" + i; },
  i => function () { throw { name: "thrown" + i }; },
  () => function () { log.push(this instanceof Moment, typeof this); return 1; },
  () => function () { return {}; },
];
const makers = [i => new Date(1000 + i), i => [i, 2], i => new Map([[i, 1]]), i => new Error("e" + i), () => /x/g, i => new Set([i]), i => Promise.resolve(i), i => new Uint8Array([i])];
function make(i) {
  const thing = makers[i % makers.length](i);
  globalThis["left" + (i % 3)] = thing;
  if (i % 4) thing[names[i % names.length]] = answers[i % answers.length](i);
  return thing;
}
function pick(i) {
  return i % 3 === 0 ? all[i % 4] : i % 3 === 1 ? make(i) : i % 5 === 2 ? pick : i;
}
const uses = [x => +x, x => x < 5, x => String(x).length > 0, x => `${x}`.length > 0, x => x == 2, x => x.clone(), x => Number(x), x => (x | 0) + 1, x => x.valueOf() === x, x => isNaN(x), x => "ab".concat(x).length > 1, x => all[1] < x, x => x.clone?.(all[2]), x => JSON.stringify([x]).length > 1];
for (let u = 0; u < uses.length; u++) {
  const seen = [];
  for (let i = 0; i < 40; i++) {
    let answer;
    try {
      answer = uses[u](pick(i));
    } catch (error) {
      answer = error.name;
    }
    seen.push(answer instanceof Moment ? "M" + answer.value : typeof answer === "object" ? "object" : String(answer), total());
  }
  console.log(u, seen.join(" "));
}
console.log(all.map(m => Object.keys(m).join() + m.sum()).join(";"), log.join());
