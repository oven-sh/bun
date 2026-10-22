// `this.run = this.run.bind(this)`: the read in the constructor finds the method of the prototype, every later read finds the bound function.
// Beside it, each thing that changes what one of the two reads finds.
function attempt(f) {
  try {
    return String(f());
  } catch (e) {
    return "throws " + e.constructor.name;
  }
}
function callLater(f) {
  return f();
}

class Worker {
  constructor(step) {
    this.count = 0;
    this.step = step;
    this.run = this.run.bind(this);
  }
  run() {
    this.count += this.step;
    return this.count;
  }
}
{
  const w = new Worker(3);
  const detached = w.run;
  console.log("own name:", w.run(), detached(), callLater(w.run), w.count);
  console.log("identity:", w.run === detached, w.run === Worker.prototype.run, Object.keys(w).join());
  console.log("members:", w.run.name, w.run.length, "prototype" in w.run, Object.hasOwn(w.run, "prototype"), typeof w.run);
  console.log("another this:", w.run.call({ count: 100, step: 1 }), Worker.prototype.run.call({ count: 100, step: 1 }));
  console.log("new:", attempt(() => new w.run()), attempt(() => Reflect.construct(w.run, [])));
  console.log("instanceof:", attempt(() => w instanceof w.run), attempt(() => 1 instanceof w.run));
}

class Faster extends Worker {
  run() {
    this.count += 10 * this.step;
    return this.count;
  }
}
{
  const f = new Faster(1);
  const w = new Worker(1);
  console.log("overridden:", callLater(f.run), callLater(w.run), f.run.name, f.run === Faster.prototype.run);
}

class Sometimes {
  constructor(bound) {
    this.count = 1;
    if (bound) this.run = this.run.bind(this);
  }
  run() {
    return this === undefined ? "no this" : this.count;
  }
}
{
  const bound = new Sometimes(true);
  const unbound = new Sometimes(false);
  console.log("one path:", callLater(bound.run), callLater(unbound.run), Object.hasOwn(bound, "run"), Object.hasOwn(unbound, "run"));
}

const patches = [];
function patch(object) {
  patches.push(object);
  object.run = function patched() {
    return "patched " + this.count;
  };
}
class Escapes {
  constructor() {
    this.count = 2;
    patch(this);
    this.run = this.run.bind(this);
  }
  run() {
    return "method " + this.count;
  }
}
console.log("escapes first:", callLater(new Escapes().run), new Escapes().run.name);

class StoresRun {
  constructor() {
    this.count = 3;
    this.run = () => "arrow of the base " + this.count;
  }
}
class BelowStoresRun extends StoresRun {
  constructor() {
    super();
    this.run = this.run.bind({ count: -1 });
  }
  run() {
    return "method " + this.count;
  }
}
console.log("base stores it:", callLater(new BelowStoresRun().run), new BelowStoresRun().run.name);

class StoresOthers {
  constructor(options) {
    if (options) this.options = options;
    this.count = 4;
  }
}
class BelowStoresOthers extends StoresOthers {
  constructor(options) {
    super(options);
    this.run = this.run.bind(this);
  }
  run() {
    return "method " + this.count + " " + this.options;
  }
}
console.log("base stores others:", callLater(new BelowStoresOthers("o").run), callLater(new BelowStoresOthers().run));

let getterCalls = 0;
class HasGetter {
  constructor() {
    this.count = 5;
    this.run = this.run.bind(this);
  }
  get run() {
    getterCalls++;
    return function fromGetter() {
      return this.count;
    };
  }
}
console.log("getter:", attempt(() => new HasGetter().run()), getterCalls);

class HasAccessors {
  constructor() {
    this.count = 6;
    this.run = this.run.bind(this);
  }
  get run() {
    return this.stored ?? function first() { return "first " + this.count; };
  }
  set run(value) {
    this.stored = value;
  }
}
{
  const h = new HasAccessors();
  console.log("accessors:", callLater(h.run), Object.hasOwn(h, "run"), Object.hasOwn(h, "stored"), h.run.name);
}

{
  const w = new Worker(1);
  const before = w.run;
  console.log("delete:", delete w.run, w.run === Worker.prototype.run, before(), attempt(() => callLater(w.run)), w.run());
}

{
  const w = new Worker(1);
  w.run = function replaced() {
    return "replaced " + this.count;
  };
  console.log("store:", w.run(), attempt(() => callLater(w.run)));
}

{
  const original = Worker.prototype.run;
  Worker.prototype.run = function late() {
    return "late " + this.count;
  };
  console.log("prototype changes:", callLater(new Worker(1).run), new Worker(1).run.name);
  Worker.prototype.run = original;
}

class Twice {
  constructor() {
    this.count = 7;
    this.run = this.run.bind(this);
    this.run = this.run.bind({ count: -7 });
  }
  run() {
    return this.count;
  }
}
console.log("bound twice:", callLater(new Twice().run), new Twice().run.name);

class ReadsItself {
  constructor() {
    this.depth = (this.depth ?? 10) + 1;
  }
}
ReadsItself.prototype.depth = 20;
console.log("data on the prototype:", new ReadsItself().depth, Object.hasOwn(new ReadsItself(), "depth"));

class Inherits extends Worker {}
{
  const i = new Inherits(4);
  console.log("inherits:", callLater(i.run), i.run(), i.run.name, Object.hasOwn(i, "run"));
}

class GetterBelow extends Worker {
  get run() {
    return function fromSubclass() {
      return "subclass " + this.count;
    };
  }
}
console.log("getter in a subclass:", attempt(() => new GetterBelow(1)), callLater(new Worker(1).run));

class FrozenAbove {
  constructor() {
    this.count = 8;
    this.run = this.run.bind(this);
  }
  run() {
    return this.count;
  }
}
console.log("before the freeze:", callLater(new FrozenAbove().run));
Object.freeze(FrozenAbove.prototype);
console.log("frozen prototype:", attempt(() => new FrozenAbove()));

class ReadOnlyAbove {
  constructor() {
    this.count = 9;
    this.run = this.run.bind(this);
  }
  run() {
    return this.count;
  }
}
Object.defineProperty(ReadOnlyAbove.prototype, "run", { writable: false });
console.log("read-only on the prototype:", attempt(() => new ReadOnlyAbove()));

class OtherTarget {
  run() {
    return "other " + this.count;
  }
}
{
  const o = Reflect.construct(Worker, [1], OtherTarget);
  console.log("other new.target:", callLater(o.run), o instanceof OtherTarget, o instanceof Worker, o.run.name);
}

class GetterInBase {
  get size() {
    return 1;
  }
}
class StoresOverBase extends GetterInBase {
  constructor() {
    super();
    this.size = 2;
  }
}
console.log("getter in the base class:", attempt(() => new StoresOverBase().size));
