const hide = value => [value][JSON.parse("0")];
function Above(raw) { this.raw = raw; this.x = 1; this.y = 2; }
let heard = [];
Object.defineProperty(Above.prototype, "status", { get() { return "above " + this.raw; }, set(v) { heard.push("above " + v); }, configurable: true });
function between(R) { function Mid(raw) { this.raw = raw; this.x = 1; this.y = 2; } Object.setPrototypeOf(Mid.prototype, R.prototype); return Mid; }
function below(R) { function Low(raw) { this.raw = raw; this.x = 1; this.y = 2; } Object.setPrototypeOf(Low.prototype, R.prototype); return Low; }
const Mid = between(Above), Low = below(Mid), holder = new Mid("holder"), One = (function (proto) { function One(raw) { this.raw = raw; this.x = 3; this.y = 4; } Object.setPrototypeOf(One.prototype, proto); return One; })(holder);
const store = (one, v) => { one.status = v; }, read = one => one.status, own = one => Object.hasOwn(one, "status") + "/" + ("status" in one) + "/" + Object.keys(one).join();
const steps = [
  () => {}, () => Object.defineProperty(Mid.prototype, "status", { value: "mid", writable: true, configurable: true }), () => delete Mid.prototype.status,
  () => Object.defineProperty(holder, "status", { value: undefined, writable: true, configurable: true, enumerable: true }), () => delete holder.status,
  () => Object.defineProperty(holder, "status", { get() { return "holder " + this.raw; }, configurable: true }), () => delete holder.status,
  () => Object.defineProperty(Above.prototype, "status", { get: undefined, set(v) { heard.push("alone " + v); }, configurable: true }),
  () => Object.defineProperty(Above.prototype, "status", { get() { return "only got"; }, set: undefined, configurable: true }),
  () => Object.defineProperty(Above.prototype, "status", { value: 7, writable: false, configurable: true }), () => Object.defineProperty(Above.prototype, "status", { value: 8, writable: true, configurable: true }),
  () => delete Above.prototype.status, () => Object.defineProperty(Above.prototype, "status", { get() { return "back " + this.raw; }, set(v) { Object.defineProperty(this, "status", { value: "lazy " + v, writable: true, configurable: true, enumerable: true }); }, configurable: true }),
  () => Object.setPrototypeOf(Low.prototype, { get status() { return "other"; }, set status(v) { heard.push("other " + v); } }), () => Object.setPrototypeOf(Low.prototype, Mid.prototype), () => Object.freeze(Low.prototype), () => Object.preventExtensions(holder)
];
for (let round = 0; round < 3; round++) steps.forEach((step, at) => {
  try { step(); } catch (error) { console.log(round, at, error.name); }
  for (const Kind of [Low, One, Mid]) {
    const fresh = hide(new Kind(at)), kept = hide(new Kind("k" + at)); heard = []; let said = "";
    for (let i = 0; i < 4; i++) { try { store(i % 2 ? kept : fresh, i); } catch (error) { said += error.name; } said += " " + String(read(fresh)) + " " + String(read(kept)); if (i === 1) { Object.defineProperty(kept, "status", { value: undefined, writable: true, configurable: true, enumerable: true }); } if (i === 2) delete kept.status; }
    console.log(round, at, Kind.name, said, own(fresh), own(kept), heard.join());
  }
});
