// More Structures than the engine remembers: functions with a read-only prototype, used as prototypes, with other properties first, generators, async functions, classes, arrows, bound functions.
const log = [];
const functions = [];
function plain() { return this === undefined ? "none" : this.v; }
function constructed() { this.made = true; return undefined; }
function asParent() { return this.v; }
function withProperty() { return this.v; }
withProperty.extra = 1;
function* generator() { yield this.v; }
async function asynchronous() { return this.v; }
class Class { static call(self) { return "static call " + self.v; } }
const arrow = () => "arrow";
const bound = plain.bind({ v: "bound this" });
new constructed();
Object.setPrototypeOf(function child() {}, asParent);
for (const f of [plain, constructed, asParent, withProperty, generator]) functions.push(f.prototype === undefined ? "no prototype" : typeof f.prototype);
const self = { v: "v" };
for (let i = 0; i < 30; i++) {
  log.length = 0;
  log.push(plain.call(self), String(constructed.call(self)), asParent.call(self), withProperty.call(self), generator.call(self).next().value, typeof asynchronous.call(self).then, Class.call(self), arrow.call(self), bound.call(self));
}
withProperty.call = () => "own";
log.push(withProperty.call(self), functions.join());
console.log(log.join(" | "));
