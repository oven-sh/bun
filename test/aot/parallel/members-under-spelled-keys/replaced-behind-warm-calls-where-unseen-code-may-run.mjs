// The same where unseen code may run: a call of what a read under an unknown key gave.
const step = Symbol("step"), size = Symbol("size"), plainKey = "plainKey";
class Meter {
  total = 0;
  [step](by) { this.total = (this.total + by) | 0; return this.total; }
  get [size]() { return this.total * 2; }
  set [size](value) { this.total = value | 0; }
  [plainKey](by) { return by + 1; }
  named(by) { return by + 2; }
}
function run(meters, turns) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let sum = work;
  for (let i = 0; i < turns; i++) {
    const meter = meters[i % meters.length];
    sum = (sum + meter[step](i)) | 0;
    meter[size] = sum & 255;
    sum = (sum + meter[size] + meter[plainKey](i) + meter.named(i)) | 0;
  }
  return sum;
}
const meters = [];
for (let i = 0; i < 300; i++) meters.push(new Meter());
console.log("warm", run(meters, 900));
Meter.prototype[step] = function (by) { return -by; };
console.log("method replaced by a store", run(meters, 900));
Object.defineProperty(Meter.prototype, size, { get() { return 7; }, set(value) { this.total = 1; }, configurable: true });
console.log("accessor replaced by a descriptor", run(meters, 900));
delete Meter.prototype[step];
try { run(meters, 3); } catch (e) { console.log("method deleted", e.name); }
meters[1][step] = by => 1000;
Meter.prototype[step] = by => 1;
console.log("one object shadows", run(meters, 900));
Reflect.defineProperty(Meter.prototype, plainKey, { value: by => 5, configurable: true, writable: true });
console.log("text key replaced", run(meters, 900));
Object.setPrototypeOf(Meter.prototype, { [size]: 1, named() { return 0; } });
delete Meter.prototype[size];
delete Meter.prototype.named;
console.log("found further up", run(meters, 900));
console.log(Reflect.ownKeys(Meter.prototype).map(String).join());
console.log(({ answer() { return "open"; } })[JSON.parse('"answer"')]());
