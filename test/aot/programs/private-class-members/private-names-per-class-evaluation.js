// Every evaluation of a class creates new private names. One class declaration creates one set.
function describeOutcome(f) {
  try {
    return String(f());
  } catch (e) {
    return "threw " + e.name;
  }
}
function show(...parts) {
  console.log(parts.join(" | "));
}

function createBox(tag) {
  return class Box {
    shown = tag;
    #value = tag;
    #method() {
      return "method " + this.#value;
    }
    get #accessor() {
      return "accessor " + this.#value;
    }
    static #count = 0;
    static has(o) {
      return [#value in o, #method in o, #accessor in o].join();
    }
    static hasStatic(o) {
      return #count in o;
    }
    static read(o) {
      return o.#value;
    }
    static write(o, value) {
      o.#value = value;
      return o.#value;
    }
    static call(o) {
      return o.#method();
    }
    static readAccessor(o) {
      return o.#accessor;
    }
    static methodOf(o) {
      return o.#method;
    }
    static increment() {
      return ++this.#count;
    }
  };
}

const classes = [createBox("first"), createBox("second"), createBox("third")];
const instances = classes.map(Box => new Box());
for (let i = 0; i < classes.length; i++) {
  for (let j = 0; j < instances.length; j++) {
    const Box = classes[i];
    const o = instances[j];
    show(
      "class " + i + " on instance " + j,
      Box.has(o),
      describeOutcome(() => Box.read(o)),
      describeOutcome(() => Box.call(o)),
      describeOutcome(() => Box.readAccessor(o)),
      describeOutcome(() => Box.write(o, "written " + i)),
      Box.hasStatic(classes[j]),
    );
  }
}

const sites = [];
for (let i = 0; i < 100; i++) {
  const Box = classes[i % 3];
  const o = instances[(i + 1) % 3];
  sites.push([Box.has(o), describeOutcome(() => Box.read(o))].join(" "));
}
show("one site over three evaluations", [...new Set(sites)].join(" / "));

show("one method per evaluation", classes[0].methodOf(instances[0]) === classes[0].methodOf(new classes[0]()));
show("methods differ between evaluations", classes[0].methodOf(instances[0]) === classes[1].methodOf(instances[1]));
show("one static field per evaluation", classes[0].increment(), classes[0].increment(), classes[1].increment(), classes[2].increment());

for (let i = 0; i < classes.length; i++) {
  const o = instances[i];
  show(
    "inspected",
    Bun.inspect(classes[i]),
    Bun.inspect(o),
    Reflect.ownKeys(o).join(),
    Object.getOwnPropertySymbols(o).length,
    JSON.stringify(o),
  );
}

const loopClasses = [];
for (let i = 0; i < 3; i++) {
  loopClasses.push(
    class {
      #number = i;
      static read(o) {
        return o.#number;
      }
    },
  );
}
for (let i = 0; i < 3; i++) {
  show(
    "class " + i + " of a loop",
    describeOutcome(() => loopClasses[i].read(new loopClasses[0]())),
    describeOutcome(() => loopClasses[i].read(new loopClasses[1]())),
    describeOutcome(() => loopClasses[i].read(new loopClasses[2]())),
  );
}

class Once {
  shown = "once";
  #value = "declared once";
  #method() {
    return this.#value + " method";
  }
  static has(o) {
    return [#value in o, #method in o].join();
  }
  static read(o) {
    return o.#value + ", " + o.#method();
  }
}
function createOnce() {
  return new Once();
}
const once = [createOnce(), createOnce(), createOnce()];
for (const o of once) show("declared once", Once.has(o), describeOutcome(() => Once.read(o)), Bun.inspect(o));
show("declared once, other objects", Once.has({}), describeOutcome(() => Once.read({})), Once.has(instances[0]), describeOutcome(() => Once.read(instances[0])));
