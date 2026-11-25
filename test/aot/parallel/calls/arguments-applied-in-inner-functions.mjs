// Functions that pass their arguments on with apply() and are called by name where they are declared.
const show = (name, run) => {
  try {
    console.log(name, run());
  } catch (error) {
    console.log(name, "threw", error.name);
  }
};

show("method", () => {
  function render(view) { return "<" + view.title() + ">"; }
  function logged() { return render.apply(this, arguments); }
  return logged({ title: function () { return "home"; } });
});

show("methods of two objects", () => {
  function join(left, right) { return left.first() + right.second(); }
  function logged() { return join.apply(this, arguments); }
  return logged({ first: () => "a", second: () => "b" }, { second: () => "c" }) + logged({ first: () => 1 }, { second: () => 2 }, { third: () => 3 });
});

show("function", () => {
  function run(callback, value) { return callback(value); }
  function logged() { return run.apply(this, arguments); }
  return logged(x => x * 3, 2) + logged(function (text) { return text.length; }, "four");
});

show("method of the receiver", () => {
  function render(view) { return this.prefix + view.title(); }
  function logged() { return render.apply(this, arguments); }
  return logged.call({ prefix: "p" }, { title: () => "home" });
});

show("accessors", () => {
  class View {
    constructor(text) { this.text = text; }
    title() { return this.text; }
    get size() { return this.text.length; }
    set name(value) { this.text = value; }
  }
  function render(view) { view.name = "x" + view.text; return view.title() + view.size; }
  function logged() { return render.apply(this, arguments); }
  const view = new View("home");
  return logged(view) + view.text;
});

show("stored field", () => {
  function change(box) { box.value = "text"; }
  function logged() { return change.apply(this, arguments); }
  const box = { value: 1 };
  const before = box.value + 1;
  logged(box);
  return [before, box.value, typeof box.value, box.value + 1].join();
});

show("counted field", () => {
  function count(box) { box.value = box.value + 1; }
  function logged() { return count.apply(this, arguments); }
  const box = { value: 1 };
  for (let i = 0; i < 5; i++) logged(box);
  return box.value;
});

show("deleted field", () => {
  function drop(object) { delete object.a; object.c = 1; return Object.keys(object).join(); }
  function logged() { return drop.apply(this, arguments); }
  const object = { a: 1, b: 2 };
  return [logged(object), object.a, "a" in object, JSON.stringify(object)].join();
});

show("pushed elements", () => {
  function fill(list) { list.push("a"); list[0] = 2.5; }
  function logged() { return fill.apply(this, arguments); }
  const list = [1, 2, 3];
  logged(list);
  return [list.join(), list.length, list[0] + 1].join();
});

show("returned object", () => {
  function same(object) { return object; }
  function logged() { return same.apply(this, arguments); }
  const made = logged({ a: 1, b: function () { return this.a; } });
  return [made.a, made.b(), JSON.stringify(made)].join();
});

show("two functions that pass on", () => {
  function render(view, suffix) { return view.title() + suffix(); }
  function inner() { return render.apply(this, arguments); }
  function outer() { return inner.apply(this, arguments); }
  return outer({ title: () => "home" }, () => "!");
});

show("rest behind apply", () => {
  function titles(...views) { return views.map(view => view.title()).join(); }
  function logged() { return titles.apply(this, arguments); }
  return logged({ title: () => "a" }, { title: () => "b" }, { title: () => "c" });
});

show("rest list applied", () => {
  function render(view, other) { return view.title() + (other ? other.title() : "-"); }
  function logged(...list) { return render.apply(this, list); }
  function spread(...list) { return render(...list); }
  return logged({ title: () => "a" }) + spread({ title: () => "b" }, { title: () => "c" });
});

show("applied twice", () => {
  function first(view) { return view.first(); }
  function second(view) { return view.second(); }
  function both() { return first.apply(this, arguments) + second.apply(this, arguments); }
  return both({ first: () => "a", second: () => "b" });
});

show("changed between two applies", () => {
  const first = { apply(object, list) { list[0] = { second: () => "stored" }; return "first"; } };
  function second(view) { return view.second(); }
  function both() { return first.apply(this, arguments) + second.apply(this, arguments); }
  return both({ second: () => "passed" });
});

show("changed in a loop", () => {
  let turns = 0;
  function last(view) { return view.title(); }
  const target = { apply(object, list) { const said = last.apply(object, list); list[0] = { title: () => "turn" + ++turns }; return said; } };
  function looped() { let said = ""; for (let i = 0; i < 3; i++) said += target.apply(this, arguments); return said; }
  return looped({ title: () => "passed" });
});

show("fewer and more arguments", () => {
  function pair(a, b) { return (a ? a.name() : "none") + (b ? b.name() : "none"); }
  function logged() { return pair.apply(this, arguments); }
  return [logged(), logged({ name: () => "a" }), logged({ name: () => "b" }, { name: () => "c" }, { name: () => "d" })].join();
});

show("also handed out", () => {
  function render(view) { return view.title(); }
  function logged() { return render.apply(this, arguments); }
  const handed = [{ title: () => "a" }, { title: () => "b" }].map(logged);
  return handed.join() + logged({ title: () => "c" });
});

show("constructor", () => {
  function Shape() { this.begin.apply(this, arguments); }
  Shape.prototype.begin = function (options) { this.width = options.width(); this.height = options.height; };
  const shape = new Shape({ width: () => 4, height: 2.5 });
  return shape.width * shape.height;
});

function makeLogger(name) {
  const seen = [];
  function write(entry) { seen.push(name + ":" + entry.format()); return seen.length; }
  function traced() { return write.apply(this, arguments); }
  return { count: traced({ format() { return "first"; } }), seen };
}
const made = makeLogger("log");
console.log("made", made.count, made.seen.join());

async function load(view) {
  await null;
  return view.title();
}
show("asynchronous", () => {
  function logged() { return load.apply(this, arguments); }
  logged({ title: () => "home" }).then(title => console.log("loaded", title), error => console.log("loaded", error.name));
  return "called";
});
