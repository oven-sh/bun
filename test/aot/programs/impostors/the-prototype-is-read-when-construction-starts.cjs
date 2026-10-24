const log = [];

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return String(value);
}

function attempt(label, run) {
  let line;
  try {
    line = label + " -> " + show(run());
  } catch (error) {
    line = label + " -> threw " + error.constructor.name;
  }
  console.log(line + (log.length ? " | log " + log.splice(0).join(", ") : ""));
}

function nothing() {}

function Late(callback) {
  callback();
  this.value = 1;
}
const firstOfLate = { who: () => "first" };
const secondOfLate = { who: () => "second" };
Late.prototype = firstOfLate;

function makeLate(callback) {
  return new Late(callback);
}

function whoIs(thing) {
  return thing.who();
}

let count = 0;
for (let i = 0; i < 2000; i++) if (whoIs(makeLate(nothing)) === "first") count++;
console.log("2000 honest constructions", count);

attempt("the prototype is replaced while the constructor runs", () => whoIs(makeLate(() => { Late.prototype = secondOfLate; })));
attempt("the next one has the new prototype", () => whoIs(makeLate(nothing)));
Late.prototype = firstOfLate;
attempt("the prototype is replaced while the argument is computed", () => whoIs(new Late((Late.prototype = secondOfLate, nothing))));
Late.prototype = firstOfLate;
attempt("the old prototype object is patched while the constructor runs", () => whoIs(makeLate(() => { firstOfLate.who = () => "patched"; })));
firstOfLate.who = () => "first";
attempt("the instance is moved while the constructor runs", () => {
  function Moved() {
    Object.setPrototypeOf(this, secondOfLate);
    this.value = 1;
  }
  Moved.prototype = firstOfLate;
  return whoIs(new Moved());
});

function Watched() {
  log.push("body");
  this.value = 1;
}
Watched.prototype.who = () => "watched";
const watcher = new Proxy(Watched, {
  get(target, key, receiver) {
    log.push("get " + String(key));
    return Reflect.get(target, key, receiver);
  },
});
attempt("new of a proxy reads prototype before the body", () => whoIs(new watcher()));
attempt("Reflect.construct for a proxy reads prototype before the body", () => whoIs(Reflect.construct(Watched, [], watcher)));
attempt("the list of arguments is read before prototype", () => whoIs(Reflect.construct(Watched, { get length() { log.push("get length"); return 0; } }, watcher)));

class Base {
  constructor() {
    log.push("base body");
    this.fromBase = true;
  }
  who() {
    return "base";
  }
}
class Derived extends Base {
  constructor(before) {
    log.push("derived body");
    before();
    super();
    this.fromDerived = true;
  }
  who() {
    return "derived";
  }
}
function Target() {}
Target.prototype = firstOfLate;

for (let i = 0; i < 2000; i++) new Derived(nothing);
log.length = 0;
attempt("a class for itself", () => whoIs(new Derived(nothing)));
attempt("a class for a function", () => whoIs(Reflect.construct(Derived, [nothing], Target)));
attempt("the function's prototype is replaced before super()", () => whoIs(Reflect.construct(Derived, [() => { Target.prototype = secondOfLate; }], Target)));
Target.prototype = firstOfLate;
attempt("a class for a proxy: prototype is read at super()", () => whoIs(Reflect.construct(Derived, [nothing], new Proxy(Target, { get(target, key) { log.push("get " + String(key)); return target[key]; } }))));
attempt("a prototype that is a getter of a bound function's target", () => whoIs(Reflect.construct(Derived, [nothing], Target.bind(null))));
attempt("honest again", () => [whoIs(makeLate(nothing)), whoIs(new Derived(nothing))]);
