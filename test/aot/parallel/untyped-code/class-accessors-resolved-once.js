// A getter of a class that is read by name is asked of the run time once for each shape of receiver, and the prototype need not make its members for that. What was learnt ends when the prototype changes.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
// Env: JSC_aotCountsPath=/dev/null
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const attempt = f => { try { return f(); } catch (error) { return error.constructor.name + ": " + error.message; } };
class Temperature {
  celsius = 20;
  get fahrenheit() { return this.celsius * 9 / 5 + 32; }
  set fahrenheit(value) { this.celsius = (value - 32) * 5 / 9; }
  get label() { return this.celsius + " C"; }
  set only(value) { this.celsius = value; }
  get failing() { throw new RangeError("too hot at " + this.celsius); }
  describe() { return this.label + " = " + this.fahrenheit + " F"; }
  reset() { this.celsius = 20; return this; }
}
class Kelvin extends Temperature {
  offset = 273;
  get label() { return this.celsius + this.offset + " K"; }
  get base() { return super.label; }
}
class Lab extends Kelvin {
  room = "lab";
}
function fahrenheits(t, turns) { let sum = 0; for (let i = 0; i < turns; i++) sum += t.fahrenheit; return sum; }
function labels(t, turns) { let text = ""; for (let i = 0; i < turns; i++) text = t.label; return text; }
function onlys(t, turns) { let seen; for (let i = 0; i < turns; i++) seen = t.only; return seen; }
const asked = () => count("operationAOTGetByIdAndCache");
const receivers = [new Temperature(), new Kelvin(), new Lab()];
let most = 0;
const results = [];
for (const read of [fahrenheits, labels, onlys]) {
  for (const receiver of receivers) {
    const before = asked();
    results.push(read(receiver, 500));
    most = Math.max(most, asked() - before);
  }
}
console.log(results.join());
console.log(most <= 3 ? "no getter was asked of the run time more than three times" : "the run time was asked " + most + " times for one getter of one class");
const [plain, kelvin, lab] = receivers;
console.log(plain.describe(), "|", kelvin.describe(), "|", lab.describe(), "|", lab.base);
for (let i = 0; i < 20; i++) plain.fahrenheit = 212;
for (let i = 0; i < 20; i++) lab.only = 5;
console.log(plain.celsius, lab.celsius, labels(plain, 5), labels(lab, 5), fahrenheits(lab, 2));
let failures = "";
for (let i = 0; i < 8; i++) failures = attempt(() => kelvin.failing);
console.log(failures);

// A getter is redefined, shadowed, deleted, and made a value.
Object.defineProperty(Kelvin.prototype, "label", { get() { return "about " + (this.celsius + 273); }, configurable: true });
console.log(labels(plain.reset(), 5), labels(kelvin, 5), labels(lab.reset(), 5));
Object.defineProperty(Lab.prototype, "label", { value: "a value", writable: true, configurable: true });
console.log(labels(plain, 5), labels(kelvin, 5), labels(lab, 5));
delete Lab.prototype.label;
delete Kelvin.prototype.label;
console.log(labels(plain, 5), labels(kelvin, 5), labels(lab, 5));
Object.defineProperty(lab, "label", { get() { return "its own"; }, configurable: true });
console.log(labels(lab, 5), labels(new Lab(), 5));
delete Temperature.prototype.label;
console.log(labels(plain, 5), labels(new Lab(), 5), attempt(() => plain.describe()));
console.log(Object.getOwnPropertyNames(Temperature.prototype).join(), typeof Object.getOwnPropertyDescriptor(Temperature.prototype, "fahrenheit").set, fahrenheits(plain, 3), onlys(kelvin, 3));
if (typeof gc === "function") gc(); else if (typeof Bun !== "undefined") Bun.gc(true);
console.log(fahrenheits(new Lab(), 100), onlys(new Temperature(), 3));
