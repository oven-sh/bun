const some = Symbol("some");
class Base {
  count = 0;
}
let Lazy;
function getLazy() {
  if (Lazy) return Lazy;
  Lazy = class Socket extends Base {
    plain(by) {
      this.count = (this.count + by) | 0;
      return this.count;
    }
    [some](by) {
      this.count = (this.count + by * 2) | 0;
      return this.count;
    }
  };
  return Lazy;
}
const mixed = [new (getLazy())(), new Base(), new (getLazy())(), new Base()];
function readPlain(object, i) {
  const method = object.plain;
  if (method !== undefined) return method.call(object, i);
  return -1;
}
function readSymbol(object, i) {
  const method = object[some];
  if (method !== undefined) return method.call(object, i);
  return -2;
}
function kept(object) {
  const method = object.plain;
  return method == null ? String(method) : typeof method + " " + method.name + " " + (method === getLazy().prototype.plain);
}
function run(from, to) {
  let sum = 0;
  for (let i = from; i < to; i++) sum = (sum + readPlain(mixed[i & 3], i) + readSymbol(mixed[(i + 1) & 3], i)) | 0;
  return sum;
}
const steps = [
  () => {},
  () => { getLazy().prototype.plain = function other(by) { return by + 1000; }; },
  () => { mixed[0].plain = function own(by) { return by - 7; }; },
  () => { mixed[1][some] = function ownOfBase(by) { return this.count + by; }; },
  () => { delete getLazy().prototype[some]; },
  () => { Base.prototype[some] = function above(by) { return 5; }; },
  () => { Object.defineProperty(getLazy().prototype, "plain", { get() { return undefined; }, configurable: true }); },
  () => { Object.setPrototypeOf(mixed[2], { plain(by) { return 3 * by; } }); },
  () => { mixed[3].plain = null; },
];
let at = 0;
for (const step of steps) {
  step();
  let answer;
  try {
    answer = run(at, at + 400);
  } catch (error) {
    answer = error.constructor.name;
  }
  console.log(answer, mixed.map(object => object.count).join(), mixed.map(kept).join(" | "));
  at += 400;
}
