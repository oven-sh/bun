// @bun
// Each line: the frames of an error in a text that runs as it is written. The engine lists a function at its end while it disposes resources, a `==` behind its last operand,
// a sum with a text among its operands behind the operand that is converted, and `Reflect["construct"]` as a call of a native function.
function fail() {
  throw new Error("fail");
}
const converts = {
  valueOf() {
    throw new RangeError("converted");
  },
  toString() {
    throw new RangeError("written");
  },
};
const point = { x: 1 };
function framesOf(error) {
  return String(error.stack)
    .split("\n")
    .map(text => /^\s*at (.*?) ?\(?(?:[^ ()]*\.mjs:(\d+):(\d+)|native)\)?$/.exec(text))
    .filter(found => found !== null && found[1] !== "show" && found[1] !== "async show" && found[1] !== "module code")
    .map(found => found[1] + "@" + (found[2] ? found[2] + ":" + found[3] : "native"))
    .join(" < ");
}
async function show(label, run) {
  try {
    await run(1);
    console.log(label, "| no error");
  } catch (error) {
    console.log(label, "|", error.constructor.name, "|", framesOf(error));
  }
}
const resource = dispose => ({ [Symbol.dispose]: dispose });
const asyncResource = dispose => ({ [Symbol.asyncDispose]: dispose });
await show("an arrow function", () => {
  using first = resource(() => fail());
  return 1;
});
await show("a function expression", function run() {
  using first = resource(() => {});
  using second = resource(() => fail());
  first;
});
function declared() {
  using first = resource(() => fail());
}
await show("a declaration", declared);
class Holder {
  method() {
    using first = resource(() => fail());
  }
  static make() {
    {
      using first = resource(() => fail());
    }
    return 1;
  }
  get read() {
    using first = resource(() => fail());
    return 1;
  }
}
await show("a method", () => new Holder().method());
await show("a block in a static method", () => Holder.make());
await show("a getter", () => new Holder().read);
await show("a method of a literal", () =>
  ({
    method() {
      using first = resource(() => fail());
    },
  }).method(),
);
await show("the body throws too", () => {
  using first = resource(() => fail());
  fail();
});
await show("a loop head", () => {
  for (using first of [resource(() => fail())]) {
    first;
  }
});
await show("await using", async () => {
  await using first = asyncResource(async () => fail());
  first;
});
await show("behind an await", async () => {
  using first = resource(() => fail());
  await null;
});
await show("a generator", () => {
  function* steps() {
    using first = resource(() => fail());
    yield 1;
  }
  return [...steps()];
});
await show("object == name in an if", n => {
  if (converts == n) return 1;
});
await show("name == object in an if", n => {
  if (n == converts) return 1;
});
await show("object == name in a condition", n => (converts == n ? 1 : 2));
await show("object == name behind &&", n => {
  if (point.x && converts == n) return 1;
});
await show("object != name in a loop", n => {
  while (converts != n) n++;
});
await show("name == object behind ||", n => {
  if (!point.x || n == converts) return 1;
});
await show("a member behind a comparison of names", n => {
  if (n == point.x) return null.x;
});
await show("a template behind a text", n => n + "s" + `${n}` + converts);
await show("a template first", n => `${n}` + "s" + converts);
await show("a template last", n => n + "s" + converts + `${n}`);
await show("two texts", n => n + "s" + "t" + converts);
await show("a number behind a text", n => "s" + 1 + converts);
class Thrower {
  constructor() {
    fail();
  }
}
await show("a dot", () => Reflect.construct(Thrower, []));
await show("brackets", () => Reflect["construct"](Thrower, []));
await show("brackets and a template", () => Reflect[`construct`](Thrower, []));
