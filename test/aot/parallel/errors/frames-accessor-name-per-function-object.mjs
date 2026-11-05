// The name of a getter and a setter in the first stack frame, for an object or a class that is created repeatedly: before and after something looks up `name` on that object's own accessor functions.
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never);
const firstFrame = stack =>
  stack
    .split("\n")[1]
    .trim()
    .replace(/ ?\(.*\)$/, "");
function nameOf(g) {
  return g.name;
}
function makeHolder(round) {
  return {
    get made() {
      return new Error("x" + round).stack;
    },
    set made(value) {
      this.stack = new Error("x" + value).stack;
    },
  };
}
const framesOf = holder => [firstFrame(holder.made), ((holder.made = 1), firstFrame(holder.stack))].join(" | ");
const looks = {
  "read out of a descriptor": holder => {
    const { get, set } = Object.getOwnPropertyDescriptor(holder, "made");
    return [nameOf(get), nameOf(set)];
  },
  "read once they came back out of code made at run time": holder => {
    const { get, set } = Object.getOwnPropertyDescriptor(holder, "made");
    return [nameOf(handedBack(get)), nameOf(handedBack(set))];
  },
  "read out of all the descriptors": holder => {
    const { get, set } = Object.getOwnPropertyDescriptors(holder).made;
    return [nameOf(get), nameOf(set)];
  },
  "read out of a descriptor that Reflect made": holder => {
    const { get, set } = Reflect.getOwnPropertyDescriptor(holder, "made");
    return [nameOf(get), nameOf(set)];
  },
  "looked up": holder => [nameOf(holder.__lookupGetter__("made")), nameOf(holder.__lookupSetter__("made"))],
  "the getter alone": holder => [nameOf(Object.getOwnPropertyDescriptor(holder, "made").get)],
  "the setter alone": holder => [nameOf(Object.getOwnPropertyDescriptor(holder, "made").set)],
  "asked whether they have one": holder => {
    const { get, set } = Object.getOwnPropertyDescriptor(holder, "made");
    return [Object.hasOwn(get, "name"), Object.hasOwn(set, "name")];
  },
  "listed": holder => {
    const { get, set } = Object.getOwnPropertyDescriptor(holder, "made");
    return [Reflect.ownKeys(get).join(), Reflect.ownKeys(set).join()];
  },
  "taken out and left alone": holder => {
    const { get, set } = Object.getOwnPropertyDescriptor(holder, "made");
    return [typeof get, typeof set];
  },
};
for (const [look, run] of Object.entries(looks)) {
  for (let round = 0; round < 3; round++) {
    const holder = makeHolder(round);
    const other = makeHolder(round);
    const before = framesOf(holder);
    console.log(look + ": " + [before, run(holder).join(" "), framesOf(holder), framesOf(other)].join(" || "));
  }
}
for (let round = 0; round < 3; round++) {
  const holder = {
    get called() {
      return new Error("x" + round).stack;
    },
  };
  const { get } = Object.getOwnPropertyDescriptor(holder, "called");
  console.log(
    "called by value: " +
      [
        firstFrame(get.call(holder)),
        firstFrame(get()),
        nameOf(get),
        firstFrame(get.call(holder)),
        firstFrame(get()),
        firstFrame(holder.called),
      ].join(" | "),
  );
}
class Once {
  get ofClass() {
    return new Error("x").stack;
  }
}
for (let round = 0; round < 3; round++) {
  const holder = new Once();
  const before = firstFrame(holder.ofClass);
  console.log(
    "a class made once: " +
      [before, nameOf(Object.getOwnPropertyDescriptor(Once.prototype, "ofClass").get), firstFrame(holder.ofClass)].join(
        " | ",
      ),
  );
}
for (let round = 0; round < 3; round++) {
  class Again {
    get ofObjects() {
      return new Error("x" + round).stack;
    }
    static get ofClass() {
      return new Error("x" + round).stack;
    }
    set ofObjects(value) {
      this.stack = new Error("x" + value + round).stack;
    }
  }
  const holder = new Again();
  const frames = () =>
    [firstFrame(holder.ofObjects), firstFrame(Again.ofClass), ((holder.ofObjects = 1), firstFrame(holder.stack))].join(
      " | ",
    );
  const before = frames();
  const ofObjects = Object.getOwnPropertyDescriptor(Again.prototype, "ofObjects");
  console.log(
    "a class made again: " +
      [
        before,
        nameOf(ofObjects.get),
        nameOf(Object.getOwnPropertyDescriptor(Again, "ofClass").get),
        nameOf(ofObjects.set),
        frames(),
      ].join(" || "),
  );
}
for (let round = 0; round < 3; round++) {
  const holder = {
    get shown() {
      return new Error("x" + round).stack;
    },
  };
  const before = firstFrame(holder.shown);
  const { get } = Object.getOwnPropertyDescriptor(holder, "shown");
  handedBack(get).displayName = "displayed";
  const displayed = firstFrame(holder.shown);
  console.log("given a displayName, read: " + [before, displayed, nameOf(get), firstFrame(holder.shown)].join(" | "));
}
const kept = [];
for (let round = 0; round < 4; round++) {
  kept.push({
    get keptFor() {
      return new Error("x" + round).stack;
    },
  });
}
nameOf(Object.getOwnPropertyDescriptor(kept[1], "keptFor").get);
nameOf(Object.getOwnPropertyDescriptor(kept[3], "keptFor").get);
console.log("two of four were read: " + kept.map(holder => firstFrame(holder.keptFor)).join(" | "));
function deep(holder, depth) {
  return depth ? deep(holder, depth - 1) : holder.keptFor;
}
console.log("from further in: " + kept.map((holder, index) => firstFrame(deep(holder, index * 3))).join(" | "));
