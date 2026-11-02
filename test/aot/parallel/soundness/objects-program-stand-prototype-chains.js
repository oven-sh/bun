// Objects that no class made stand in prototype chains: above the prototype object of a constructor function, between two of them, between an instance and its class. They get names, accessors and other parents late.
const Unknown = structuredClone({}).constructor;
function hide(x) { return Unknown(x); }
function show(...parts) { console.log(parts.map(String).join(" | ")); }
function attempt(f) { try { return f(); } catch (error) { return error.constructor.name; } }
const log = [];

// 1: the parent of the prototype object is an object of the program. The constructor creates its fields under it.
{
  const shared = { kind: "shared" };
  function Point(x) { this.a = x; this.b = x + 1; this.c = x + 2; }
  Point.prototype = Object.create(shared);
  Point.prototype.sum = function () { return this.a + this.b + this.c; };
  hide(Point);
  function run(n) { let total = 0; for (let i = 0; i < n; i++) { const p = new Point(i); total += p.sum() + Object.keys(p).length; } return total; }
  show("1a", run(300), new Point(1).kind);
  Object.defineProperty(hide(shared), "b", { set(v) { log.push("1 set b " + v); }, get() { return 100; }, configurable: true });
  show("1b", run(3), Object.keys(new Point(1)).join(), log.length);
  delete hide(shared).b;
  show("1c", run(3), Object.keys(new Point(1)).join());
  Object.defineProperty(hide(shared), "c", { value: 7, writable: false, configurable: true });
  show("1d", attempt(() => run(3)), attempt(() => Object.keys(new Point(1)).join()));
  delete hide(shared).c;
  hide(shared).sum = function () { return -1; };
  show("1e", run(3));
  delete hide(Point.prototype).sum;
  show("1f", run(3));
}

// 2: an object of the program between the prototype objects of two constructor functions.
{
  function Base() { this.events = 0; }
  Base.prototype.on = function () { this.events++; return this; };
  Base.prototype.name = function () { return "base"; };
  function Stream(size) { Base.call(this); this.size = size; this.ended = false; }
  const between = Object.create(Base.prototype);
  Object.setPrototypeOf(Stream.prototype, between);
  Stream.prototype.end = function () { this.ended = true; return this.on(); };
  hide(Stream); hide(Base);
  function run(n) { let total = 0; for (let i = 0; i < n; i++) { const s = new Stream(i).end().on(); total += s.events + s.name().length + Object.keys(s).length; } return total; }
  show("2a", run(300));
  hide(between).name = function () { return "between"; };
  show("2b", run(3), new Stream(1).name());
  hide(Base.prototype).on = function () { this.events += 10; return this; };
  show("2c", run(3));
  Object.defineProperty(hide(between), "size", { set(v) { log.push("2 set size " + v); }, configurable: true });
  show("2d", run(3), Object.keys(new Stream(4)).join(), log.length);
  Object.setPrototypeOf(hide(between), { on() { this.events += 100; return this; }, name() { return "other parent"; } });
  show("2e", run(3), new Stream(1) instanceof Base);
}

// 3: each instance gets a prototype of the application, which leads back to the class.
{
  function Emitter() { this.count = 0; }
  Emitter.prototype.emit = function (n) { this.count += n; return this.count; };
  function Incoming(url) { Emitter.call(this); this.url = url; this.complete = false; }
  Object.setPrototypeOf(Incoming.prototype, Emitter.prototype);
  Incoming.prototype.header = function (name) { return name + "@" + this.url; };
  hide(Incoming); hide(Emitter);
  const library = Object.create(Incoming.prototype);
  library.get = function (name) { return this.header(name).length; };
  const application = Object.create(library);
  function handle(i) {
    const request = new Incoming("/" + i);
    Object.setPrototypeOf(request, application);
    request.next = i; request.params = null; request.route = "r";
    return request.get("host") + request.emit(2) + request.header("a").length + Object.keys(request).length;
  }
  function run(n) { let total = 0; for (let i = 0; i < n; i++) total += handle(i % 10); return total; }
  show("3a", run(300), new Incoming("x") instanceof Incoming, Object.setPrototypeOf(new Incoming("y"), application) instanceof Emitter);
  hide(application).header = function (name) { return name; };
  show("3b", run(3), new Incoming("z").header("h"));
  Object.defineProperty(hide(library), "params", { set(v) { log.push("3 set params " + v); }, get() { return "from library"; }, configurable: true });
  show("3c", run(3), log.length);
  hide(application).emit = function () { return 1000; };
  show("3d", run(3), new Incoming("z").emit(1));
  Object.setPrototypeOf(hide(library), { header() { return "cut off"; }, emit() { return 5; } });
  show("3e", run(3), Object.setPrototypeOf(new Incoming("y"), application) instanceof Incoming);
}

// 4: the same with classes, and one object hides a method under a key that arrives late.
{
  class Shape { constructor(w) { this.w = w; } area() { return this.w * this.w; } get twice() { return this.w * 2; } }
  class Box extends Shape { constructor(w, h) { super(w); this.h = h; } area() { return this.w * this.h; } label() { return "box" + this.area(); } }
  hide(Shape); hide(Box);
  function measure(o) { return o.area() + o.twice + o.label().length; }
  function run(list, n) { let total = 0; for (let i = 0; i < n; i++) total += measure(list[i % list.length]); return total; }
  const boxes = [new Box(1, 2), new Box(2, 3), new Box(3, 4)];
  show("4a", run(boxes, 300));
  hide(boxes[1])[hide(["area"])[0]] = function () { return 1; };
  show("4b", run(boxes, 3), Object.keys(boxes[1]).join());
  Object.defineProperty(hide(boxes[2]), "twice", { get() { return -1; }, configurable: true });
  show("4c", run(boxes, 3));
  const custom = Object.create(Box.prototype);
  Object.setPrototypeOf(boxes[0], hide(custom));
  show("4d", run(boxes, 3), boxes[0] instanceof Box);
  custom.label = function () { return "custom"; };
  show("4e", run(boxes, 3));
  Object.setPrototypeOf(boxes[0], null);
  show("4f", attempt(() => measure(boxes[0])), boxes[0] instanceof Box, boxes[0].w);
}

// 5: a method is assigned to the prototype object after an instance got a prototype that has the name already.
{
  function Late(v) { this.v = v; }
  hide(Late);
  const early = new Late(1);
  Object.setPrototypeOf(early, hide(Object.create(Late.prototype, { read: { value() { return "mine " + this.v; }, configurable: true, writable: true } })));
  Late.prototype.read = function () { return "class " + this.v; };
  function read(o) { return o.read(); }
  const list = [new Late(2), early, new Late(3)];
  const answers = new Set();
  for (let i = 0; i < 300; i++) answers.add(read(list[i % 3]));
  show("5", [...answers].join(), early instanceof Late);
}

// 6: an object that is constructed for a function nobody knows inherits from what that function names.
{
  class Task { constructor(id) { this.id = id; this.done = false; } finish() { this.done = true; return this.id; } describe() { return "task " + this.id; } }
  hide(Task);
  function Special() {}
  Special.prototype = Object.create(Task.prototype);
  Special.prototype.describe = function () { return "special " + this.id; };
  function run(n) {
    let text = "";
    for (let i = 0; i < n; i++) {
      const task = i % 3 ? new Task(i) : Reflect.construct(Task, [i], hide(Special));
      text = task.describe() + "/" + task.finish() + "/" + Object.keys(task).length;
    }
    return text;
  }
  show("6a", run(299), run(300), run(301));
  hide(Special.prototype).finish = function () { return "never"; };
  show("6b", run(299), run(300), run(301));
}
show("log", log.join("; "));
