// The errors the language itself throws, each with its name and message, and the same constructs used legally.
function report(label, body) {
  try {
    console.log(label, "returned", body());
  } catch (error) {
    console.log(label, "threw", error.name, error.message);
  }
}

class Base {
  value = 1;
  read() {
    return this.value;
  }
}

report("uninitialized binding", () => {
  const read = () => late;
  const result = read();
  let late = 1;
  return result + late;
});
report("initialized binding", () => {
  let early = 1;
  const read = () => early;
  return read();
});

report("unresolvable reference", () => notDeclaredAnywhere);
report("typeof unresolvable reference", () => typeof notDeclaredAnywhere);

report("constant assignment", () => {
  class Immutable {
    static rebind() {
      Immutable = 2;
    }
  }
  Immutable.rebind();
  return typeof Immutable;
});
report("let assignment", () => {
  let variable = 1;
  variable = 2;
  return variable;
});

report("uninitialized this", () => {
  class Early extends Base {
    constructor() {
      const value = this.value;
      super();
      this.copy = value;
    }
  }
  return new Early().copy;
});
report("this after super", () => {
  class Late extends Base {
    constructor() {
      super();
      this.copy = this.value;
    }
  }
  return new Late().copy;
});

report("this already bound", () => {
  class Twice extends Base {
    constructor() {
      super();
      super();
    }
  }
  return new Twice().value;
});
report("one super call", () => {
  class Once extends Base {
    constructor() {
      super();
    }
  }
  return new Once().value;
});

report("delete super property", () => {
  class Deleter extends Base {
    remove() {
      return delete super.read;
    }
  }
  return new Deleter().remove();
});
report("delete own property", () => {
  const object = { member: 1 };
  return delete object.member;
});

report("destructure named property of null", () => {
  const source = null;
  const { member } = source;
  return member;
});
report("destructure named property of undefined", () => {
  const source = undefined;
  const { member } = source;
  return member;
});
report("destructure empty pattern of null", () => {
  const source = null;
  const {} = source;
  return 0;
});
report("destructure object", () => {
  const source = { member: 1 };
  const { member } = source;
  return member;
});

report("derived constructor result in named class", () => {
  class Named extends Base {
    constructor() {
      super();
      return 1;
    }
  }
  return new Named().value;
});
report("derived constructor result in anonymous class", () => {
  const Anonymous = (() =>
    class extends Base {
      constructor() {
        super();
        return 1;
      }
    })();
  return new Anonymous().value;
});
report("derived constructor returns object", () => {
  class ReturnsObject extends Base {
    constructor() {
      super();
      return { value: 2 };
    }
  }
  return new ReturnsObject().value;
});

report("static prototype key", () => {
  const key = "proto" + "type";
  class Static {
    static [key] = 1;
  }
  return Static.prototype;
});
report("static other key", () => {
  const key = "proto" + "col";
  class Static {
    static [key] = 1;
  }
  return Static.protocol;
});

report("iterator result not object", () => {
  const iterable = {
    [Symbol.iterator]() {
      return {
        next() {
          return 1;
        },
      };
    },
  };
  for (const element of iterable) return element;
  return "no element";
});
report("iterator result object", () => {
  const iterable = {
    [Symbol.iterator]() {
      return {
        next() {
          return { done: true };
        },
      };
    },
  };
  for (const element of iterable) return element;
  return "no element";
});

function iteratorFor(hasThrowMethod) {
  const iterator = {
    [Symbol.iterator]() {
      return this;
    },
    next() {
      return { done: false, value: 1 };
    },
    return() {
      console.log("return called");
      return {};
    },
  };
  if (hasThrowMethod)
    iterator.throw = () => ({ done: true, value: "handled" });
  return iterator;
}
function* delegate(hasThrowMethod) {
  return yield* iteratorFor(hasThrowMethod);
}
report("iterator without throw method", () => {
  const generator = delegate(false);
  generator.next();
  return generator.throw(new Error("thrown in")).value;
});
report("iterator with throw method", () => {
  const generator = delegate(true);
  generator.next();
  return generator.throw(new Error("thrown in")).value;
});
