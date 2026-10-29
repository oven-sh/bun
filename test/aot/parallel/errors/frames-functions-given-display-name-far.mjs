// Prints what the first stack frame calls a function that got its displayName far from where it is written, before and after something looks for the property `name` of the function object.
const firstFrame = stack =>
  stack
    .split("\n")[1]
    .trim()
    .replace(/ ?\(.*\)$/, "");
const parsed = JSON.parse('{"list":[]}');
function farFrom(f) {
  Bun.peek(f);
  parsed.list.push(f);
  return parsed.list.at(-1);
}
const makers = {
  arrow() {
    let made;
    made = () => new Error("x").stack;
    return made;
  },
  method() {
    return {
      made() {
        return new Error("x").stack;
      },
    }.made;
  },
  async() {
    return async function made() {
      return new Error("x").stack;
    };
  },
  function() {
    return function made() {
      return new Error("x").stack;
    };
  },
};
const nameOf = f => f.name;
const looks = {
  "nothing": f => f,
  "a read": f => void f.name,
  "a read of length": f => void f.length,
  "a read where others were read": f => nameOf(f),
  "in": f => "name" in f,
  "hasOwnProperty": f => f.hasOwnProperty("name"),
  "Object.hasOwn": f => Object.hasOwn(f, "name"),
  "Object.keys": f => Object.keys(f),
  "Object.getOwnPropertyNames": f => Object.getOwnPropertyNames(f),
  "Reflect.ownKeys": f => Reflect.ownKeys(f),
  "Object.getOwnPropertyDescriptor": f => Object.getOwnPropertyDescriptor(f, "name"),
  "a pattern": ({ name }) => name,
  "a spread": f => ({ ...f }),
  "for in": f => {
    for (const _key in f);
  },
  "a store": f => {
    try {
      f.name = "stored";
    } catch (error) {
      return error;
    }
  },
  "Object.freeze": f => Object.freeze(f),
  "defined with the text it had": f => Object.defineProperty(f, "name", { value: "made" }),
  "defined with another text": f => Object.defineProperty(f, "name", { value: "defined" }),
  "deleted": f => delete f.name,
  "read and deleted": f => [f.name, delete f.name],
};
for (const [kind, make] of Object.entries(makers)) {
  for (const [label, look] of Object.entries(looks)) {
    const looked = make();
    const other = make();
    farFrom(looked).displayName = "displayed";
    farFrom(other).displayName = "displayed";
    const before = firstFrame(await looked());
    look(farFrom(looked));
    console.log(`${kind} | ${label} | ${before} | ${firstFrame(await looked())} | ${firstFrame(await other())}`);
  }
  const first = make();
  void farFrom(first).name;
  farFrom(first).displayName = "displayed";
  const second = make();
  farFrom(second).displayName = "displayed";
  console.log(
    `${kind} | a displayName given after the read | ${firstFrame(await first())} | ${firstFrame(await second())}`,
  );
  const described = make();
  farFrom(described).displayName = "displayed";
  console.log(
    kind,
    Reflect.ownKeys(described),
    JSON.stringify(Object.getOwnPropertyDescriptor(described, "name")),
    described.name,
  );
  const frozen = Object.freeze(farFrom(make()));
  console.log(kind, Object.isFrozen(frozen), frozen.name, JSON.stringify(Object.getOwnPropertyDescriptors(frozen)));
}
const madeOnce = () => new Error("x").stack;
farFrom(madeOnce).displayName = "displayed";
{
  const before = firstFrame(madeOnce());
  Object.hasOwn(farFrom(madeOnce), "name");
  console.log(`a function that is made once | ${before} | ${firstFrame(madeOnce())}`);
}
const getter = Object.getOwnPropertyDescriptor(
  {
    get g() {
      return new Error("x").stack;
    },
  },
  "g",
).get;
farFrom(getter).other = 1;
{
  const before = firstFrame(getter());
  Object.hasOwn(farFrom(getter), "name");
  console.log(`a getter | ${before} | ${firstFrame(getter())}`);
}
{
  const looked = makers.arrow();
  const other = makers.arrow();
  farFrom(looked).displayName = "displayed";
  farFrom(other).displayName = "displayed";
  Object.keys(farFrom(looked));
  const prepare = Error.prepareStackTrace;
  Error.prepareStackTrace = (error, sites) => sites[0].getFunctionName();
  console.log(`call sites | ${looked()} | ${other()}`);
  Error.prepareStackTrace = prepare;
}
