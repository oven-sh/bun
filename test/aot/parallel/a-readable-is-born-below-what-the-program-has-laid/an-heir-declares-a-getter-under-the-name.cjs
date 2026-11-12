const { Readable } = require("node:stream");
const said = [];
const say = (...words) => said.push(words.map(String).join(" "));
const describe = stream => {
  const symbols = Object.getOwnPropertySymbols(stream).map(symbol => String(symbol) + "=" + String(stream[symbol]));
  return (
    Object.keys(stream).join(",") +
    " | " +
    symbols.join(",") +
    " | table " +
    Object.keys(stream._events).join(",") +
    " below " +
    (Object.getPrototypeOf(stream._events) === null ? "nothing" : "an object")
  );
};
const bear = (name, make) => {
  try {
    say(name + ":", describe(make()));
  } catch (error) {
    say(name, "throws", error.constructor.name, error.message.split(" (")[0]);
  }
};
class Heir extends Readable {
  constructor(options) {
    super(options);
    this.made = "up";
  }
}
class HeirOfHeir extends Heir {}
class Other extends Readable {
  get __proto__() {
    say("the getter that the class declares runs");
    return { _events: undefined };
  }
}
const bearAll = when => {
  for (let turn = 0; turn < 3; turn++) {
    bear(when + " an heir", () => new Heir());
    bear(when + " an heir of the heir", () => new HeirOfHeir({ read() {} }));
    bear(when + " another heir", () => new Other());
    bear(when + " a readable", () => new Readable());
    bear(when + " the heir under the other's new.target", () => Reflect.construct(Heir, [], Other));
    bear(when + " a readable under a plain function's new.target", () =>
      Reflect.construct(Readable, [], function () {}),
    );
  }
};
bearAll("before");
bearAll("behind");
console.log(said.join("\n"));
