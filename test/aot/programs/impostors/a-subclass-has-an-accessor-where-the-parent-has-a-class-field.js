const log = [];

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function print(label, run) {
  let line;
  try {
    line = label + " -> " + show(run());
  } catch (error) {
    line = label + " -> threw " + error.constructor.name;
  }
  console.log(line + (log.length ? " | log " + log.splice(0).join(", ") : ""));
}

class HasAField {
  level = 1;
  other = "other";
  raise() {
    this.level += 1;
    return this.level;
  }
}

function withAccessor(Parent) {
  return class extends Parent {
    get level() {
      log.push("get level");
      return this.kept === undefined ? "nothing kept" : this.kept;
    }
    set level(value) {
      log.push("set level " + value);
      this.kept = value;
    }
  };
}

function withGetterOnly(Parent) {
  return class extends Parent {
    get level() {
      log.push("get level");
      return 50;
    }
  };
}

function withFieldOverAccessor(Parent) {
  return class extends withAccessor(Parent) {
    level = "a field again";
  };
}

function withMethodNamedLevel(Parent) {
  return class extends Parent {
    level() {
      return "a method";
    }
  };
}

function withStaticLevel(Parent) {
  return class extends Parent {
    static level = "static";
  };
}

function levelOf(thing) {
  return thing.level;
}

function setLevel(thing) {
  thing.level = 7;
  return thing.level;
}

function raise(thing) {
  return thing.raise();
}

for (const Parent of [HasAField]) {
  let sum = 0;
  for (let i = 0; i < 2000; i++) {
    const honest = new Parent(1);
    sum += levelOf(honest) + setLevel(honest) + raise(honest);
  }
  console.log(Parent.name, "2000 honest rounds", sum);

  const children = [
    ["an accessor pair", withAccessor],
    ["only a getter", withGetterOnly],
    ["a field over the accessor", withFieldOverAccessor],
    ["a method named level", withMethodNamedLevel],
    ["a static level", withStaticLevel],
  ];

  for (const [label, derive] of children) {
    const Child = derive(Parent);
    const where = Parent.name + ", " + label;
    print(where + ": construct", () => new Child(1));
    print(where + ": owns level", () => Object.hasOwn(new Child(1), "level"));
    log.length = 0;
    print(where + ": level", () => { const child = new Child(1); log.length = 0; const level = levelOf(child); return typeof level === "function" ? "a function" : level; });
    print(where + ": level = 7", () => { const child = new Child(1); log.length = 0; return setLevel(child); });
    print(where + ": raise()", () => { const child = new Child(1); log.length = 0; return raise(child); });
    print(where + ": honest again", () => [levelOf(new Parent(1)), setLevel(new Parent(1)), raise(new Parent(1))]);
  }
}
