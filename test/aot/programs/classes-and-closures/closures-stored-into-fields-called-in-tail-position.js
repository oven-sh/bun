// Members that hold functions nobody has read are called in tail position, by code that knows nothing of the receiver. A tail call leaves no frame behind, however deep it goes.
const lines = [];
function say(...values) {
  lines.push(values.map(String).join(" "));
}
// What comes out of evaluated text is a value that the compiler knows nothing about.
const hide = new Function("value", "return value");
function attempt(action) {
  try {
    return String(action());
  } catch (error) {
    return error.constructor.name;
  }
}

class Reply {
  #raw;
  constructor(raw) {
    this.#raw = raw;
  }
  text = (text, code) => this.#raw + ":" + text + ":" + (code ?? 200);
  json = value => JSON.stringify(value) + this.#raw;
  plain = function (suffix) {
    return "plain " + (this === undefined ? "nobody" : this.label) + suffix;
  };
  later = async value => (await value) + this.#raw;
  none = () => "nothing captured";
  label = "reply";
  missing = undefined;
  nothing = null;
}

// The form of a handler: one call, in tail position.
const handlers = [c => c.text("x"), c => c.json({ a: 1 }), c => c.plain("!"), c => c.none(), c => c.text("y", 404)];
function dispatch(handler, c) {
  return handler(c);
}
const seen = new Set();
for (let i = 0; i < 400; i++) seen.add(dispatch(handlers[i % handlers.length], hide(new Reply("r" + (i % 2)))));
say([...seen].join(" | "));

// What is no function is reported by the caller.
say(attempt(() => (c => c.missing())(hide(new Reply("m")))));
say(attempt(() => (c => c.nothing())(hide(new Reply("n")))));
say(attempt(() => (c => c.absent())(hide(new Reply("a")))));
say(attempt(() => (c => c.label())(hide(new Reply("l")))));
say(attempt(() => (c => c.text())(hide(null))));

// The function object is the same whoever asks first.
const first = hide(new Reply("f"));
const called = (c => c.text("called"))(first);
say(called, first.text === first.text, (c => c.text("again"))(first), first.json !== new Reply("g").json);

// A hundred thousand deep: more frames than the stack has room for.
class Deep {
  down = (n, sum) => (n === 0 ? sum : this.down(n - 1, sum + 1));
  byName = (n, sum) => (n === 0 ? sum : next(hidden, n - 1, sum + 1));
}
function next(object, n, sum) {
  return object.byName(n, sum);
}
const hidden = hide(new Deep());
say("deep", new Deep().down(100000, 0), hidden.byName(100000, 0), next(hide(new Deep()), 3, 0));

// An object that has been through collections before its member is first called.
const old = [];
for (let i = 0; i < 50; i++) old.push(hide(new Reply("old" + i)));
Bun.gc(true);
Bun.gc(true);
const answers = old.map(c => dispatch(handlers[0], c));
Bun.gc(true);
say("old", answers[0], answers[49], old.every((c, i) => c.text("x") === answers[i]), old[3].text === old[3].text);

say("async", await (c => c.later(Promise.resolve("later ")))(hide(new Reply("z"))));
console.log(lines.join("\n"));
