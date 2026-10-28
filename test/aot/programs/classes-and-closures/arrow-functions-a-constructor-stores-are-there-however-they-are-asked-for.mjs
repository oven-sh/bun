// A constructor of an untyped class stores arrow functions over `this`. Most of them are never read; each way of asking finds them.
const lines = [];
const say = (label, run) => {
  try {
    lines.push(label + ": " + run());
  } catch (error) {
    lines.push(label + ": " + error.constructor.name);
  }
};

class Holder {
  constructor(name) {
    this.name = name;
    this.first = () => this.name + " first";
    this.second = suffix => this.name + " second " + suffix;
    this.third = () => this;
    this.fourth = () => "fourth";
    this.fifth = () => this.first() + "|" + this.fourth();
  }
}

const make = name => new Holder(name);
const key = name => name.split("").join("");

say("never read", () => typeof make("a"));
say("by name", () => make("b").first());
say("by a computed key", () => make("c")[key("second")]("x"));
say("keys", () => Object.keys(make("d")).join());
say("entries", () =>
  Object.entries(make("e"))
    .map(([name, value]) => name + ":" + typeof value)
    .join(),
);
say("spread", () => {
  const holder = make("f");
  const copy = { ...holder };
  return copy.first() + "," + (copy.third() === holder) + "," + (copy.first === holder.first);
});
say("assign", () => Object.assign({}, make("g")).fifth());
say("destructured", () => {
  const { second, fourth } = make("h");
  return second("y") + "," + fourth();
});
say("descriptor", () => {
  const descriptor = Object.getOwnPropertyDescriptor(make("i"), "third");
  return [typeof descriptor.value, descriptor.writable, descriptor.enumerable, descriptor.configurable].join();
});
say("the same function each time", () => {
  const holder = make("j");
  return holder.first === holder.first && holder[key("first")] === holder.first;
});
say("in", () => "fourth" in make("k") && Object.hasOwn(make("k"), "fifth"));
say("deleted", () => {
  const holder = make("l");
  delete holder.first;
  return typeof holder.first + "," + Object.keys(holder).join();
});
say("deleted and read by another", () => {
  const holder = make("m");
  delete holder.first;
  return holder.fifth();
});
say("stored over", () => {
  const holder = make("n");
  holder.first = () => "other";
  return holder.fifth();
});
say("stored over with a number", () => {
  const holder = make("o");
  holder.fourth = 4;
  return holder.fourth + "," + typeof holder.third;
});
say("frozen", () => {
  const holder = Object.freeze(make("p"));
  return holder.fifth() + "," + Object.isFrozen(holder);
});
say("name and length", () => {
  const holder = make("q");
  return holder.second.name + "," + holder.second.length + "," + holder.first.name;
});
say("a property on the function stays", () => {
  const holder = make("r");
  holder.first.mark = 1;
  return holder.first.mark;
});
say("for in", () => {
  const names = [];
  for (const name in make("s")) names.push(name);
  return names.join();
});
say("json", () => JSON.stringify(make("t")));
say("structured as a prototype", () => Object.create(make("u")).fifth());

class WithSetter extends Holder {
  set extra(value) {
    lines.push("the setter got " + typeof value);
  }
  constructor(name) {
    super(name);
    this.extra = () => this.name;
  }
}
say("a setter above takes the store", () => Object.keys(new WithSetter("v")).join());

let calls = 0;
class Watched {
  constructor() {
    this.run = () => ++calls;
  }
}
Object.defineProperty(Watched.prototype, "run", {
  configurable: true,
  set(value) {
    lines.push("a setter defined later got " + typeof value);
  },
});
say("a setter defined later", () => typeof new Watched().run);
delete Watched.prototype.run;
say("and removed again", () => new Watched().run());

let sum = 0;
for (let index = 0; index < 2000; index++) sum += make("w" + index).second("z").length;
lines.push("in a loop: " + sum);

console.log(lines.join("\n"));
