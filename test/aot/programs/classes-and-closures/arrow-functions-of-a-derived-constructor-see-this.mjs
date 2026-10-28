// Arrow functions that a derived constructor makes in front of, inside and behind its call of super().
const lines = [];
const say = (label, run) => {
  try {
    lines.push(label + ": " + run());
  } catch (error) {
    lines.push(label + ": " + error.constructor.name);
  }
};

class Base {
  constructor(name) {
    this.name = name;
  }
}

class Behind extends Base {
  constructor(name) {
    super(name);
    this.read = () => this.name;
    this.self = () => this;
    this.nested = () => () => this.name + "!";
    this.rename = next => {
      this.name = next;
      return this;
    };
  }
}
const behind = new Behind("behind");
say("behind", () => behind.read());
say("behind is itself", () => behind.self() === behind);
say("behind nested", () => behind.nested()());
say("behind renamed", () => behind.rename("renamed").read());
say("behind detached", () => (0, behind.read)());
say("two instances", () => new Behind("a").read() + new Behind("b").read());
say("own keys", () => Object.keys(behind).join());
say("one function for one instance", () => behind.read === behind.read);
say("another function for another instance", () => behind.read !== new Behind("c").read);

class InFront extends Base {
  constructor(name, early) {
    const read = () => this.name;
    if (early) read();
    super(name);
    this.read = read;
  }
}
say("made in front", () => new InFront("in front", false).read());
say("called in front", () => new InFront("in front", true).read());

class InArguments extends Base {
  constructor(name) {
    let read;
    super(((read = () => this.name), name));
    this.read = read;
  }
}
say("made in the arguments", () => new InArguments("arguments").read());

class Skipped extends Base {
  constructor(name, calls) {
    if (calls) super(name);
    const read = () => this.name;
    return { read };
  }
}
say("super was called", () => new Skipped("called", true).read());
say("super was skipped", () => new Skipped("skipped", false).read());

class ByArrow extends Base {
  constructor(name) {
    const call = () => super(name);
    const read = () => this.name;
    call();
    this.read = read;
  }
}
say("an arrow calls super", () => new ByArrow("by arrow").read());

class Twice extends Base {
  constructor(name) {
    super(name);
    this.read = () => this.name;
    super(name + " again");
  }
}
say("super twice", () => new Twice("twice").read());

class Replaced {
  constructor() {
    return { name: "what the base returned" };
  }
}
class OverReplaced extends Replaced {
  constructor() {
    super();
    this.read = () => this.name;
    this.isInstance = () => this instanceof OverReplaced;
  }
}
say("the base returns another object", () => new OverReplaced().read());
say("which is no instance", () => new OverReplaced().isInstance());

class WithFields extends Base {
  field = () => this.name + " by a field";
  constructor(name) {
    super(name);
    this.read = () => this.field();
  }
}
say("beside a field", () => new WithFields("fields").read());

class InBlock extends Base {
  constructor(name) {
    {
      super(name);
    }
    this.read = () => this.name;
  }
}
say("super in a block", () => new InBlock("block").read());

class Below extends Behind {
  constructor(name) {
    super(name);
    this.both = () => this.read() + "+" + this.name;
  }
}
say("two levels", () => new Below("below").both());

class Throws extends Base {
  constructor(name, list) {
    list.push(() => this.name);
    super(name);
    list.push(() => this.name);
    throw new RangeError("stop");
  }
}
const kept = [];
say("the constructor throws", () => new Throws("thrown", kept));
say("made in front of super, read later", () => kept[0]());
say("made behind super, read later", () => kept[1]());

class Async extends Base {
  constructor(name) {
    super(name);
    this.later = async () => {
      await null;
      return this.name;
    };
  }
}
lines.push("async: " + (await new Async("later").later()));

console.log(lines.join("\n"));
