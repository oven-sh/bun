// What the code of a static block sees: this, super, new.target, private names, the variables around it and its own.
const log = [];
const note = (...values) => log.push(values.map(String).join(" "));

class Base {
  static greeting = "base";
  static greet() {
    return "greet of " + this.name;
  }
}

let outer = 1;
class Sees extends Base {
  static #hidden = 5;
  static first = note("field 1", outer);
  static {
    note("this", this === Sees, this.name);
    note("super", super.greeting, super.greet());
    note("new.target", new.target);
    note("private", this.#hidden, #hidden in this, Sees.#hidden++);
    outer += 10;
    var ownVar = "var of block 1";
    let ownLet = "let of block 1";
    note(ownVar, ownLet);
  }
  static second = note("field 2", outer, Sees.#hidden);
  static {
    note("the var of the other block", typeof ownVar, typeof ownLet);
    const arrow = () => [this === Sees, super.greeting, new.target];
    note("an arrow", arrow());
    Sees.later = () => [this.name, ++outer, this.#hidden];
    function inner() {
      return [this, new.target];
    }
    note("a function", inner());
    note("a constructor", typeof new inner());
  }
  static third = note("field 3", outer);
}
note("later", Sees.later(), Sees.later());

function inAFunction(parameter) {
  let local = parameter * 2;
  const made = class {
    static {
      local += parameter;
      this.read = () => local;
      this.write = value => (local = value);
    }
  };
  return [made, () => local];
}
const [made, read] = inAFunction(3);
note("captured", made.read(), read());
made.write(40);
note("written", made.read(), read());

const order = [];
class Nested {
  static {
    order.push("outer begins");
    class Inner {
      static {
        order.push("inner", this.name, typeof Nested);
      }
    }
    order.push("outer ends", Inner.name);
  }
}
note(order);

outerLabel: for (const step of [1, 2, 3]) {
  class Loops {
    static {
      inner: for (const value of [1, 2, 3]) {
        if (value === 2) continue inner;
        if (value === 3) break inner;
        note("loop", step, value);
      }
    }
  }
  if (step === 2) break outerLabel;
}

let defined = "not defined";
try {
  class Stops {
    static before = note("before the throw");
    static {
      throw new RangeError("from a block");
    }
    static after = note("behind the throw");
  }
  defined = Stops.name;
} catch (error) {
  note("caught", error.name, error.message, defined);
}

try {
  class Early {
    static {
      note(Early.name, tooEarly);
    }
  }
} catch (error) {
  note("dead zone", error.name);
}
let tooEarly = 1;

class Evaluates {
  static {
    eval("var fromEval = 7; note('eval', this === Evaluates, fromEval)");
    note("behind eval", typeof fromEval);
  }
  static {
    note("in the next block", typeof fromEval);
  }
}

class Awaits {
  static async run() {
    return "ran";
  }
  static {
    this.promise = (async () => (await this.run()) + " in a block")();
    this.generator = (function* () {
      yield 1;
      yield 2;
    })();
  }
}
note("generator", [...Awaits.generator]);
Awaits.promise.then(value => {
  note("promise", value);
  console.log(log.join("\n"));
});
