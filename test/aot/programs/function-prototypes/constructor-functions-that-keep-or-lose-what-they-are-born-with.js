// A constructor function keeps its prototype object, both links and its names unless the program does something to them. Each function here has one thing done to it, early or late,
// by a store, a definition, a copy, a computed key, through an instance or through another name, and is then asked what its instances inherit.
const lines = [];
function say(name, ...values) { lines.push(name + ": " + values.join(" ")); }
function describe(make, F) {
  const p = make();
  return [p.x, p.z === undefined ? "no z" : "z " + p.z, typeof p.twice === "function" ? p.twice() : "no twice", p instanceof F, Object.getPrototypeOf(p) === F.prototype, p.constructor === F].join(" ");
}

function Plain(x) { this.x = x; }
for (let i = 0; i < 3; i++) say("plain", describe(() => new Plain(i), Plain));

function WithMethod(x) { this.x = x; }
WithMethod.prototype.twice = function () { return this.x * 2; };
for (let i = 0; i < 3; i++) say("method", describe(() => new WithMethod(i), WithMethod));

function LateName(x) { this.x = x; }
say("late name", describe(() => new LateName(1), LateName));
LateName.prototype.z = 7;
say("late name", describe(() => new LateName(2), LateName));
delete LateName.prototype.z;
say("late name", describe(() => new LateName(3), LateName));

function ReplacedEarly(x) { this.x = x; }
ReplacedEarly.prototype = { z: 1, twice() { return this.x * 3; } };
for (let i = 0; i < 2; i++) say("replaced early", describe(() => new ReplacedEarly(i), ReplacedEarly));

function ReplacedLate(x) { this.x = x; }
const beforeReplacement = new ReplacedLate(1);
say("replaced late", describe(() => new ReplacedLate(1), ReplacedLate));
ReplacedLate.prototype = { z: 2 };
say("replaced late", describe(() => new ReplacedLate(2), ReplacedLate), beforeReplacement instanceof ReplacedLate, beforeReplacement.z);

function Defined(x) { this.x = x; }
say("defined", describe(() => new Defined(1), Defined));
Object.defineProperty(Defined, "prototype", { value: { z: 3 } });
say("defined", describe(() => new Defined(2), Defined));

function Copied(x) { this.x = x; }
say("copied", describe(() => new Copied(1), Copied));
Object.assign(Copied, { prototype: { z: 4 } });
say("copied", describe(() => new Copied(2), Copied));

function Computed(x) { this.x = x; }
say("computed", describe(() => new Computed(1), Computed));
const keys = ["length", "prototype"];
Computed[keys[lines.length > 3 ? 1 : 0]] = { z: 5 };
say("computed", describe(() => new Computed(2), Computed));

function ThroughInstance(x) { this.x = x; }
const handle = new ThroughInstance(1);
say("through an instance", describe(() => new ThroughInstance(1), ThroughInstance));
handle.constructor.prototype = { z: 6 };
say("through an instance", describe(() => new ThroughInstance(2), ThroughInstance));

function Relinked(x) { this.x = x; }
say("relinked", describe(() => new Relinked(1), Relinked));
Object.setPrototypeOf(Relinked.prototype, { z: 8, twice() { return this.x * 4; } });
say("relinked", describe(() => new Relinked(2), Relinked));

function SetterLate(x) { this.x = x; }
say("setter", describe(() => new SetterLate(1), SetterLate));
let taken = 0;
Object.defineProperty(SetterLate.prototype, "x", { set(v) { taken += v; }, get() { return "from the getter"; }, configurable: true });
say("setter", describe(() => new SetterLate(2), SetterLate), taken);

function Frozen(x) { this.x = x; }
Frozen.prototype.x = 0;
Object.freeze(Frozen.prototype);
try { say("frozen", describe(() => new Frozen(1), Frozen)); } catch (error) { say("frozen", error.constructor.name); }

function makeCapturing(step) { function Capturing(x) { this.x = x + step; } Capturing.prototype.twice = function () { return this.x * 2 + step; }; return Capturing; }
const Capturing = makeCapturing(10);
for (let i = 0; i < 3; i++) say("capturing", describe(() => new Capturing(i), Capturing));

function Base(x) { this.x = x; }
Base.prototype.twice = function () { return this.x * 2; };
class Derived extends Base { thrice() { return this.x * 3; } }
say("derived", describe(() => new Derived(1), Derived), new Derived(2).thrice(), new Derived(3) instanceof Base);
function Other() {}
Other.prototype.z = 9;
say("other new.target", describe(() => Reflect.construct(Base, [4], Other), Other), describe(() => new Base(5), Base));

function WithStatics(x) { this.x = x; }
WithStatics.count = 0;
say("statics", WithStatics.count, WithStatics.missing, describe(() => new WithStatics(1), WithStatics));
Object.setPrototypeOf(WithStatics, { missing: "found above" });
say("statics", WithStatics.count, WithStatics.missing, describe(() => new WithStatics(2), WithStatics));

function HasInstance(x) { this.x = x; }
say("hasInstance", new HasInstance(1) instanceof HasInstance, ({}) instanceof HasInstance);
Object.defineProperty(HasInstance, Symbol.hasInstance, { value: () => true });
say("hasInstance", new HasInstance(1) instanceof HasInstance, ({}) instanceof HasInstance);

console.log(lines.join("\n"));
