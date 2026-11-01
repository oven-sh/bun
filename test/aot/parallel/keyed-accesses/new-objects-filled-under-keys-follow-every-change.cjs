// `out[key] = value` into one new object after another, so that each store adds a name, while what lies above the objects changes.
function write(base, key, value) {
  base[key] = value;
}
class Strict {
  static write(base, key, value) {
    base[key] = value;
  }
}
const strictWrite = Strict.write;
function attempt(store, base, key, value) {
  try {
    store(base, key, value);
    return "stored";
  } catch (error) {
    return error.constructor.name;
  }
}
function Made() {}
const shared = { inherited: "from above" };
const upper = { inherited: "from far above" };
const lower = Object.create(upper);
const makers = {
  "an empty literal": () => ({}),
  "a literal with a name": () => JSON.parse('{"first":1}'),
  "without a prototype": () => Object.create(null),
  "below an object": () => Object.create(shared),
  "made by a function": () => new Made(),
  "two below an object": () => Object.create(lower),
  "an array": () => [1, 2],
  "a function": () => function () {},
};

const unread = process.env.NAME_OF_NO_VARIABLE;
const keys = [unread || "alpha", unread || "bravo", ["char", "lie"].join(""), unread || "delta", Symbol("echo")];
const show = object =>
  Reflect.ownKeys(object)
    .filter(key => key !== "length" && key !== "name" && key !== "prototype")
    .map(key => String(key) + "=" + String(object[key]))
    .join();
function fill(store, make, names = keys, rounds = 80) {
  let last;
  for (let round = 0; round < rounds; round++) {
    last = make();
    for (let i = 0; i < names.length; i++) store(last, names[i], round + i);
  }
  return last;
}

for (const [name, make] of Object.entries(makers)) {
  const say = (...values) => console.log(name + ":", ...values);
  const above = Object.getPrototypeOf(make());

  say("filled", show(fill(write, make)), "|", show(fill(strictWrite, make)));
  say("in the other order", show(fill(write, make, keys.toReversed())));
  say("some of them", show(fill(write, make, [keys[1], keys[3]])), "|", show(fill(write, make, [keys[0], keys[1]])));

  const one = make();
  const other = make();
  for (const key of keys) {
    write(one, key, "one");
    write(other, key, "other");
    write(one, key, "one again");
  }
  say("each its own", show(one), "|", show(other));

  let kept = 0;
  for (let round = 0; round < 10; round++) {
    const held = [];
    for (let i = 0; i < 200; i++) {
      const object = make();
      for (const key of keys) write(object, key, { round, i, text: "text " + i });
      held.push(object);
    }
    Bun.gc(round & 1 ? true : false);
    if (held.every((object, i) => keys.every(key => object[key].i === i && object[key].text === "text " + i))) kept++;
  }
  say("across collections", kept);

  const many = [];
  for (let i = 0; i < 24; i++) many.push("name" + i);
  const full = fill(write, make, many, 40);
  say("more names than the storage began with", many.map(key => full[key]).join());

  for (const limit of ["preventExtensions", "seal", "freeze"]) {
    fill(write, make);
    const closed = Object[limit](make());
    say(
      limit,
      attempt(write, closed, keys[0], 1),
      attempt(strictWrite, closed, keys[0], 1),
      keys[0] in closed,
      show(fill(write, make)),
    );
    const half = make();
    write(half, keys[0], "before");
    Object[limit](half);
    say(limit + " half way", attempt(write, half, keys[1], 1), attempt(strictWrite, half, keys[1], 1), show(half));
  }

  if (!above) continue;
  // The prototypes of the built-ins cannot be changed in an executable.
  for (const holder of [Object.prototype, Array.prototype, Function.prototype].includes(above)
    ? []
    : above === lower
      ? [lower, upper]
      : [above]) {
    const where = holder === upper ? "on the object above that" : "on the object above";
    for (const key of [keys[1], keys[4]]) {
      fill(write, make);
      fill(strictWrite, make);
      let heard = [];
      Object.defineProperty(holder, key, { set: value => void heard.push(value), configurable: true });
      say(
        "a setter",
        where,
        show(fill(write, make, keys, 3)),
        heard.join(),
        "|",
        show(fill(strictWrite, make, keys, 2)),
        heard.join(),
      );
      delete holder[key];
      say("the setter is gone", where, show(fill(write, make)), heard.length);

      Object.defineProperty(holder, key, { value: "fixed", writable: false, configurable: true });
      const sloppy = make();
      const strict = make();
      say(
        "read-only",
        where,
        keys.map(each => attempt(write, sloppy, each, 1)).join(),
        show(sloppy),
        "|",
        keys.map(each => attempt(strictWrite, strict, each, 1)).join(),
        show(strict),
      );
      Object.defineProperty(holder, key, { value: "free", writable: true, configurable: true });
      say("writable", where, show(fill(write, make)), String(holder[key]));
      delete holder[key];
      say("gone", where, show(fill(write, make)));
    }
  }

  fill(write, make);
  const heard = [];
  const between = Object.create(above, { [keys[2]]: { set: value => void heard.push(value), configurable: true } });
  const moved = make();
  write(moved, keys[0], 0);
  Object.setPrototypeOf(moved, between);
  for (const key of keys) write(moved, key, "moved");
  say("another object above one of them", show(moved), heard.join(), "|", show(fill(write, make)));

  const log = [];
  const trapped = make();
  Object.setPrototypeOf(
    trapped,
    new Proxy(above, {
      set(target, key, value, receiver) {
        log.push(String(key));
        return Reflect.defineProperty(receiver, key, {
          value: "through the trap",
          writable: true,
          enumerable: true,
          configurable: true,
        });
      },
    }),
  );
  for (const key of keys) write(trapped, key, "direct");
  say("a proxy above one of them", show(trapped), log.join(), "|", show(fill(write, make)));
}
