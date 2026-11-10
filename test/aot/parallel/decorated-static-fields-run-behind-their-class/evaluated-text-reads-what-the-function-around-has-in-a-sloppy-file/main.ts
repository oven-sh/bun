// A static field with a legacy decorator is assigned behind its class, in the function around the class. Text that its value evaluates is text of that function:
// it reads the function's `this`, `arguments`, `new.target` and `super`. The control: a field without a decorator keeps its own `this`.
// This file has no import and no export and names `this` at its top, so it is a CommonJS file and sloppy: `this` of a call is an object, and at the top it is module.exports.
function mark(_target: unknown, _key: string) {}
function attempt(work: () => unknown): string {
  try {
    return String(work());
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
function self(this: unknown, round: number) {
  class Registry {
    @mark static value = eval("typeof this");
  }
  return Registry.value + ":" + round;
}
function count(this: unknown, round: number, _more?: string) {
  class Registry {
    @mark static value = eval("arguments.length");
  }
  return Registry.value + ":" + round;
}
function first(this: unknown, round: number) {
  class Registry {
    @mark static value = eval("arguments[0] + round");
  }
  return Registry.value + ":" + round;
}
function target(this: unknown, round: number) {
  class Registry {
    @mark static value = eval("typeof new.target");
  }
  return Registry.value + ":" + round;
}
function Made(this: { value: unknown }) {
  class Registry {
    @mark static value = eval("new.target === Made");
  }
  this.value = Registry.value;
}
function viaArrow(this: unknown, _round: number) {
  const build = () => {
    class Registry {
      @mark static value = eval("arguments.length + ':' + typeof this");
    }
    return Registry.value;
  };
  return build();
}
function arrowInTheValue(this: unknown, _round: number, _more: string) {
  class Registry {
    @mark static value = (() => eval("arguments.length + ':' + typeof this"))();
  }
  return Registry.value;
}
class Base {
  hello() {
    return "base";
  }
}
class Derived extends Base {
  hello() {
    return "derived";
  }
  run(_round: number) {
    class Registry {
      @mark static value = eval("super.hello() + ':' + this.hello() + ':' + arguments.length");
    }
    return Registry.value;
  }
}
function unmoved(this: unknown, round: number) {
  class Registry {
    static value = eval("typeof this");
  }
  return Registry.value + ":" + round;
}
class AtTheTop {
  @mark static value = eval("typeof this");
  @mark static written: unknown = this;
  @mark static inAnArrow: unknown = (() => this)();
}
function writtenIn(this: unknown) {
  class Registry {
    @mark static value: unknown = this;
    @mark static inAnArrow: unknown = (() => this)();
  }
  return Registry.value + ":" + Registry.inAnArrow;
}
const rounds = JSON.parse("[2]") as number[];
const round = rounds[0]!;
console.log(
  attempt(() => self.call("text", round)),
  attempt(() => count.call("text", round, "more")),
  attempt(() => first.call("text", round)),
);
console.log(
  attempt(() => target.call("text", round)),
  attempt(() => new (Made as unknown as new () => { value: unknown })().value),
);
console.log(
  attempt(() => viaArrow.call("text", round)),
  attempt(() => arrowInTheValue.call("text", round, "more")),
);
console.log(
  attempt(() => new Derived().run(round)),
  attempt(() => unmoved.call("text", round)),
  AtTheTop.value,
);
console.log(String(AtTheTop.written), String(AtTheTop.inAnArrow), String(this), writtenIn.call("text"));
