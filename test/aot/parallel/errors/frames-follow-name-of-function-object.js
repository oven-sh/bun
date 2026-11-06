// Stack frames follow the name of the function object.
const top = (s, n = 2) =>
  String(s)
    .split("\n")
    .filter(l => l.trimStart().startsWith("at "))
    .slice(0, n)
    .map(l => l.trim().replace(/ ?\(?[^ (]*:\d+:\d+\)?$/, ""))
    .join(" | ");
const rename = (f, n) => Object.defineProperty(f, "name", { value: n });
function plain(n) {
  return rename(function () {
    return new Error("x").stack;
  }, n);
}
function arrow(n) {
  return rename(() => new Error("x").stack, n);
}
function method(n) {
  return rename(
    {
      m() {
        return new Error("x").stack;
      },
    }.m,
    n,
  );
}
function getter(n) {
  return rename(
    Object.getOwnPropertyDescriptor(
      {
        get g() {
          return new Error("x").stack;
        },
      },
      "g",
    ).get,
    n,
  );
}
function klass(n) {
  return rename(
    class {
      constructor() {
        this.s = new Error("x").stack;
      }
    },
    n,
  );
}
function ctor(n) {
  return rename(function F() {
    this.s = new Error("x").stack;
  }, n);
}
function derived(n) {
  return rename(
    class extends Object {
      constructor() {
        super();
        this.s = new Error("x").stack;
      }
    },
    n,
  );
}
for (const make of [plain, arrow, method, getter]) {
  const a = make("a1"),
    b = make("b1");
  console.log(make.name, top(a()), "/", top(b()), "/", top(a.call(null)), "/", top(Reflect.apply(b, null, [])));
}
for (const make of [klass, ctor, derived]) {
  const A = make("A1"),
    B = make("B1");
  console.log(make.name, top(new A().s), "/", top(new B().s), "/", top(Reflect.construct(A, []).s));
}
{
  const a = plain("first");
  console.log("changed between calls", top(a()));
  rename(a, "second");
  console.log(top(a()));
}
{
  let self;
  self = rename(function () {
    const e = new Error("x");
    rename(self, "while-live");
    return e.stack;
  }, "before");
  console.log("changed while live", top(self()));
}
{
  const a = plain("n");
  a.displayName = "shown";
  console.log("displayName beside name", top(a()));
  const b = function written() {
    return new Error("x").stack;
  };
  b.displayName = "shown2";
  console.log("displayName alone", top(b()));
  const c = plain("n3");
  c.displayName = 7;
  console.log("displayName a number", top(c()));
  const d = plain("n4");
  d.displayName = "";
  console.log("displayName empty", top(d()));
}
{
  const g = Object.defineProperty(
    function w1() {
      return new Error("x").stack;
    },
    "name",
    {
      get() {
        return "from-getter";
      },
    },
  );
  console.log("name a getter", top(g()));
  const s = Object.defineProperty(
    function w2() {
      return new Error("x").stack;
    },
    "name",
    { value: Symbol("sym") },
  );
  console.log("name a symbol", top(s()));
  const n = Object.defineProperty(
    function w3() {
      return new Error("x").stack;
    },
    "name",
    { value: 42 },
  );
  console.log("name a number", top(n()));
  const e = Object.defineProperty(
    function w4() {
      return new Error("x").stack;
    },
    "name",
    { value: "" },
  );
  console.log("name empty", top(e()));
  const d = function w5() {
    return new Error("x").stack;
  };
  delete d.name;
  console.log("name deleted", top(d()));
}
{
  const b = plain("target").bind(null);
  console.log("bound", top(b()));
  const b2 = rename(plain("target2").bind(null), "bound-renamed");
  console.log("bound renamed", top(b2()));
}
{
  const a = plain("outer-a"),
    b = plain("outer-b");
  const nest = (f, g) =>
    rename(function () {
      return f === null ? new Error("x").stack : g();
    }, "nest");
  const x = rename(function () {
      return a();
    }, "x1"),
    y = rename(function () {
      return x();
    }, "y1");
  console.log("nested", top(y(), 4));
}
{
  function rec(n) {
    const f = rename(function (k) {
      return k ? f2(k - 1) : new Error("x").stack;
    }, "rec" + n);
    return f;
  }
  const f1 = rec(1);
  var f2 = rec(2);
  console.log("two closures in one stack", top(f1(2), 4));
}
{
  const a = plain("cs");
  const old = Error.prepareStackTrace;
  Error.prepareStackTrace = (e, sites) =>
    sites
      .slice(0, 2)
      .map(s => s.getFunctionName() + ":" + typeof s.getFunction())
      .join(" | ");
  console.log("CallSite", a());
  Error.prepareStackTrace = old;
}
{
  const a = rename(function () {
    const o = {};
    Error.captureStackTrace(o);
    return o.stack;
  }, "cst");
  console.log("captureStackTrace", top(a()));
  const inner = rename(function () {
    const o = {};
    Error.captureStackTrace(o, inner);
    return o.stack;
  }, "cut");
  const outer = rename(function () {
    return inner();
  }, "kept");
  console.log("captureStackTrace cut", top(outer()));
}
{
  const t = rename(function () {
    null.x;
  }, "thrower");
  try {
    t();
  } catch (e) {
    console.log("thrown by the engine", top(e.stack));
  }
}
{
  ("use strict");
  const leaf = plain("leaf");
  const tail = rename(function () {
    "use strict";
    return leaf();
  }, "tail");
  console.log("tail call", top(tail(), 3));
}
{
  const f = plain("collected");
  const run = () => plain("only-here-" + 1)();
  for (let i = 0; i < 3; i++) Bun.gc(true);
  console.log("after collections", top(run()), top(f()));
  const g = rename(function () {
    Bun.gc(true);
    Bun.gc(true);
    return new Error("x").stack;
  }, "collected-while-running");
  console.log(top((0, g)()));
  console.log(
    top(
      rename(function () {
        Bun.gc(true);
        Bun.gc(true);
        return new Error("x").stack;
      }, "nobody-else-holds-it")(),
    ),
  );
}
