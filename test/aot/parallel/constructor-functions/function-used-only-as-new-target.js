// A function that nothing else refers to is passed as new.target to a class over a plain function. The plain function reads new.target without keeping it.
// Allocating `this` reads the `prototype` of that function, and the new object keeps the function alive through its prototype.
// Env of the executable: BUN_JSC_validateAOTRuntime=1
function Compares() { this.x = new.target === OverCompares ? 1 : 2; }
class OverCompares extends Compares {}
const compared = Reflect.construct(OverCompares, [], function () {});
console.log(typeof compared, compared.x);

function Tests() { if (new.target) {} this.x = 2; }
class OverTests extends Tests {}
const tested = Reflect.construct(OverTests, [], function () {});
console.log(typeof tested, tested.x, Object.getPrototypeOf(tested) === OverTests.prototype);

function Declared() {}
console.log(Reflect.construct(OverCompares, [], Declared).x);

class Lower extends OverCompares { y = 3; }
const lower = Reflect.construct(Lower, [], function () {});
console.log(lower.x, lower.y);

console.log(Reflect.construct(Compares, [], function () {}) instanceof Compares);

function viaClass(N) { class D extends Tests {} return Reflect.construct(D, [], N); }
function viaSpread(N, ...rest) { class D extends Tests { constructor(...a) { super(...a); } } return Reflect.construct(D, rest, N); }
function viaArguments(N) { class D extends Tests { constructor() { super(...arguments); } } return Reflect.construct(D, [1, 2], N); }
function viaField(N) { class D extends Tests { f = 1; #p = 2; } return Reflect.construct(D, [], N); }
function viaArrow(N) { class D extends Tests { constructor() { const go = () => super(); go(); } } return Reflect.construct(D, [], N); }
for (const make of [viaClass, viaSpread, viaArguments, viaField, viaArrow]) {
  const o = make(function () {});
  Bun.gc(true);
  console.log(make.name, typeof o, o.x, typeof Object.getPrototypeOf(o).constructor, Object.getPrototypeOf(o) === Tests.prototype);
}

// The objects outlive the frames that made the functions.
function make(tag) { return Reflect.construct(OverTests, [], function () { return tag; }); }
const all = [];
for (let i = 0; i < 500; i++) all.push(make(i));
Bun.gc(true);
function recurse(n) { return n ? recurse(n - 1) + 1 : 0; }
recurse(200);
console.log(all.map(o => Object.getPrototypeOf(o).constructor()).reduce((a, b) => a + b, 0), all[7] instanceof Object.getPrototypeOf(all[7]).constructor);

function tell(run) { try { const o = run(); console.log(typeof o, o.x, Object.getPrototypeOf(o) === Object.prototype); } catch (error) { console.log(error.constructor.name); } }
tell(() => Reflect.construct(OverTests, [], function () {}.bind(null)));
tell(() => Reflect.construct(OverTests, [], () => {}));
tell(() => Reflect.construct(OverTests, [], new Proxy(function () {}, {})));
tell(() => Reflect.construct(OverTests, [], new Proxy(function () {}, { get(target, key) { return key === "prototype" ? null : target[key]; } })));
tell(() => Reflect.construct(OverTests, [], class {}));
tell(() => Reflect.construct(OverTests, [], function* () {}));
tell(() => Reflect.construct(OverTests, [], { m() {} }.m));
