// Classes with private methods, accessors and fields that nothing uses. Each definition has something to do, so each is evaluated.
const said = [];
function say(text) {
  said.push(text);
  return text;
}
function pick(value) {
  say("pick");
  return value;
}

exports.Base = class {};
exports.returnsAnother = class {
  constructor() {
    return { other: true };
  }
};
exports.plainFunction = function () {};
exports.bound = function () {}.bind(null);
exports.bound.prototype = {};
exports.proxy = new Proxy(class {}, {});
exports.nothing = null;

class BelowMember extends exports.Base {
  constructor(a, b) {
    super(1);
  }
  #hidden() {
    return 2;
  }
}
say("BelowMember");

class BelowModuleExports extends module.exports.Base {
  constructor(...all) {
    super(...all);
    this.#hidden();
  }
  #hidden() {
    return 2;
  }
}
say("BelowModuleExports");

class BelowCall extends pick(exports.Base) {
  constructor() {
    super(...arguments);
  }
  get #got() {
    return 1;
  }
  set #got(value) {}
  read() {
    return this.#got;
  }
}
say("BelowCall");

class BelowNull extends exports.nothing {
  constructor() {
    super();
    return { made: new.target };
  }
  #hidden() {}
  static test(value) {
    return #hidden in value;
  }
}
say("BelowNull");

class BelowFunction extends exports.plainFunction {
  constructor() {
    super();
  }
  static #shared() {
    return 3;
  }
  static read() {
    return BelowFunction.#shared();
  }
}
say("BelowFunction");

class BelowBound extends exports.bound {
  constructor() {
    super();
    this.#field = this.#hidden();
  }
  #field = 1;
  #hidden() {
    return this.#field;
  }
}
say("BelowBound");

class BelowProxy extends exports.proxy {
  constructor() {
    super();
  }
  #hidden() {}
  static {
    say("static block of BelowProxy");
  }
}
say("BelowProxy");

class BelowOneThatReturnsAnother extends exports.returnsAnother {
  constructor() {
    super();
    this.#hidden();
  }
  #hidden() {}
}
say("BelowOneThatReturnsAnother");

class WithoutHeritage {
  constructor(a) {
    this.#hidden();
  }
  #hidden() {}
  [say("computed key")]() {
    return this.#hidden();
  }
  static kept = say("static field");
}
say("WithoutHeritage");

class WithoutConstructor extends exports.Base {
  #hidden() {}
  call() {
    return this.#hidden();
  }
  static has(value) {
    return #hidden in value;
  }
}
say("WithoutConstructor");

const expression = class extends exports.Base {
  constructor() {
    super();
  }
  #hidden() {}
};
say("expression");

function definesInside(Base) {
  class Inside extends Base {
    constructor(a) {
      super(a);
    }
    #hidden() {}
  }
  return say("definesInside");
}
definesInside(exports.Base);
definesInside(Object);

for (const Base of [exports.Base, Object, Array, exports.plainFunction, exports.proxy, null]) {
  class InLoop extends Base {
    constructor() {
      super();
    }
    #hidden() {}
    static #shared() {}
    get #got() {
      return 1;
    }
  }
  say("InLoop");
}

for (const notAClass of [1, "text", {}, () => {}, undefined, function () {}.bind(null)]) {
  try {
    class BelowWhatIsNoClass extends notAClass {
      constructor() {
        super();
      }
      #hidden() {}
    }
    say("defined");
  } catch (error) {
    say(error.constructor.name);
  }
}

console.log(said.join("\n"));
