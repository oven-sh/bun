// What M.prototype.m answers is the function that was laid there, the one that the instances find.
function Matrix() { this.n = 2; }
Matrix.prototype.get = function (i) { let sum = 0; for (let j = 0; j < i; j++) sum += this.get(j) + 1; return sum; };
const matrix = new Matrix(), kept = [matrix.get];
console.log(kept[0] === Matrix.prototype.get, matrix.get === Matrix.prototype.get, Object.is(kept[0], Matrix.prototype.get));
console.log(kept.includes(Matrix.prototype.get), kept.indexOf(Matrix.prototype.get), new Set(kept).has(Matrix.prototype.get), new Map([[matrix.get, 1]]).get(Matrix.prototype.get), new WeakSet(kept).has(Matrix.prototype.get));
switch (matrix.get) { case Matrix.prototype.get: console.log("one"); break; default: console.log("another"); }

function Plain() {}
Plain.prototype.run = function () { return 1; };
console.log(new Plain().run === Plain.prototype.run);

const NS = {};
NS.Shape = function () { this.n = 1; };
NS.Shape.prototype = { area: function () { return this.n; }, twice() { return this.n * 2; } };
const shape = new NS.Shape();
for (let i = 0; i < 2; i++) console.log(shape.area === NS.Shape.prototype.area, shape.twice === NS.Shape.prototype.twice, NS.Shape.prototype.area.call(shape), NS.Shape.prototype.twice.apply(shape));

function Tagged() {}
Tagged.prototype.run = function () { return 1; };
const given = { run: new Tagged().run }, tagged = Tagged.prototype.run;
tagged.mark = 5;
console.log(given.run === tagged, given.run.mark, tagged.name, tagged.length);

function Called() {}
Called.prototype.run = function () { return 1; };
Called.prototype.run.call = function () { return 2; };
function CalledByInstance() {}
CalledByInstance.prototype.run = function () { return 1; };
new CalledByInstance().run.call = function () { return 2; };
console.log(Called.prototype.run.call(new Called()), new Called().run.call(), CalledByInstance.prototype.run.call(null), new CalledByInstance().run.call());

function Generating() {}
Generating.prototype.run = function* () { yield 1; };
console.log(Object.getPrototypeOf(Generating.prototype.run()) === new Generating().run.prototype, Generating.prototype.run() instanceof new Generating().run);

function Constructing() {}
Constructing.prototype.Inner = function (n) { this.n = n; };
const inner = new Constructing.prototype.Inner(5);
console.log(inner instanceof new Constructing().Inner, Object.getPrototypeOf(inner) === new Constructing().Inner.prototype, inner.constructor === Constructing.prototype.Inner, inner.n);

function Selves() {}
Selves.prototype.named = function self() { return self; };
Selves.prototype.unnamed = function () { return arguments.callee; };
console.log(Selves.prototype.named() === new Selves().named, Selves.prototype.unnamed.call(null) === new Selves().unnamed, new Selves().named() === Selves.prototype.named);

function Listener() {}
Listener.prototype.heard = function () { count++; };
let count = 0;
const target = new EventTarget();
target.addEventListener("sound", new Listener().heard);
target.removeEventListener("sound", Listener.prototype.heard);
target.dispatchEvent(new Event("sound"));
console.log(count);

function Several() {}
Several.prototype.run = function () { return 1; };
function* give() { yield Several.prototype.run; }
function raise() { try { throw Several.prototype.run; } catch (e) { return e; } }
const all = [new Several().run, Several.prototype.run, [...give()][0], raise(), ((f = Several.prototype.run) => f)(), (() => Several.prototype.run)(), Reflect.get(new Several(), "run"), Object.getPrototypeOf(new Several()).run];
console.log(new Set(all).size, all.every(f => f === all[0]));
