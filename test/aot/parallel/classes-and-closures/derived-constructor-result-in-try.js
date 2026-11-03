// The result of a derived constructor is judged after the function has been left: the TypeError for a result that is no object and the ReferenceError for a `this` that `super()` has not bound pass by every `catch` of the constructor, and come after its `finally` blocks and after the iterators of its loops are closed.
const steps = [];
class A {
  constructor() {
    steps.push("A");
  }
}
const other = { other: true };

function attempt(title, Class) {
  let outcome;
  try {
    const result = new Class();
    outcome = result === other ? "the other object" : result instanceof Class ? "an instance" : typeof result;
  } catch (error) {
    outcome = error.name;
  }
  console.log(`${title}: ${outcome}`, steps.splice(0).join());
}

attempt("return 1 in try", class B extends A {
  constructor() {
    super();
    try {
      return 1;
    } catch (e) {
      console.log("caught");
    }
  }
});
attempt("return in try, no super()", class B extends A {
  constructor() {
    try {
      return;
    } catch (e) {
      console.log("caught");
    }
  }
});
attempt("return 1 in try, no super()", class B extends A {
  constructor() {
    try {
      return 1;
    } catch (e) {
      console.log("caught");
    }
  }
});
attempt("end of try, no super()", class B extends A {
  constructor() {
    try {
      steps.push("try");
    } catch (e) {
      console.log("caught");
    }
  }
});
attempt("return in try", class B extends A {
  constructor() {
    super();
    try {
      return;
    } catch (e) {
      console.log("caught");
    }
  }
});
attempt("return undefined in try", class B extends A {
  constructor() {
    super();
    try {
      return undefined;
    } catch (e) {
      console.log("caught");
    }
  }
});
attempt("return an object in try", class B extends A {
  constructor() {
    super();
    try {
      return other;
    } catch (e) {
      console.log("caught");
    }
  }
});
attempt("return an object in try, no super()", class B extends A {
  constructor() {
    try {
      return other;
    } catch (e) {
      console.log("caught");
    }
  }
});
for (const value of [null, 0, "", "text", true, 1n, Symbol.iterator]) {
  attempt(`return ${String(value)} (${typeof value}) in try`, class B extends A {
    constructor() {
      super();
      try {
        return value;
      } catch (e) {
        console.log("caught");
      }
    }
  });
}

attempt("super() in catch", class B extends A {
  constructor() {
    try {
      return;
    } catch (e) {
      super();
    }
  }
});
attempt("nested try", class B extends A {
  constructor() {
    super();
    try {
      try {
        return 1;
      } catch (e) {
        console.log("caught by the inner handler");
      }
    } catch (e) {
      console.log("caught by the outer handler");
    }
  }
});
attempt("return 1 in catch", class B extends A {
  constructor() {
    super();
    try {
      try {
        throw new Error("thrown");
      } catch (e) {
        steps.push("catch");
        return 1;
      }
    } catch (e) {
      console.log("caught by the outer handler");
    }
  }
});
attempt("this read in try, no super()", class B extends A {
  constructor() {
    try {
      this.x = 1;
    } catch (e) {
      steps.push("caught " + e.name);
    }
  }
});

attempt("return 1 in try with finally", class B extends A {
  constructor() {
    super();
    try {
      return 1;
    } finally {
      steps.push("finally");
    }
  }
});
attempt("return in try with finally, no super()", class B extends A {
  constructor() {
    try {
      return;
    } finally {
      steps.push("finally");
    }
  }
});
attempt("super() in finally", class B extends A {
  constructor() {
    try {
      return;
    } finally {
      super();
    }
  }
});
attempt("super() in an arrow function called in finally", class B extends A {
  constructor() {
    const callSuper = () => super();
    try {
      return;
    } finally {
      callSuper();
    }
  }
});
attempt("finally returns an object", class B extends A {
  constructor() {
    super();
    try {
      return 1;
    } finally {
      return other;
    }
  }
});
attempt("finally returns nothing", class B extends A {
  constructor() {
    super();
    try {
      return 1;
    } finally {
      return;
    }
  }
});
attempt("finally returns 1", class B extends A {
  constructor() {
    super();
    try {
      return other;
    } finally {
      return 1;
    }
  }
});
attempt("finally inside try with catch", class B extends A {
  constructor() {
    super();
    try {
      try {
        return 1;
      } finally {
        steps.push("finally");
      }
    } catch (e) {
      console.log("caught");
    }
  }
});
attempt("finally breaks out of the return", class B extends A {
  constructor() {
    super();
    for (;;) {
      try {
        return 1;
      } finally {
        break;
      }
    }
    steps.push("after the loop");
  }
});

function createIterable() {
  return {
    [Symbol.iterator]() {
      return {
        next() {
          steps.push("next");
          return { done: false, value: 1 };
        },
        return() {
          steps.push("closed");
          return {};
        },
      };
    },
  };
}
attempt("return 1 in for-of", class B extends A {
  constructor() {
    super();
    for (const value of createIterable()) return value;
  }
});
attempt("return in for-of, no super()", class B extends A {
  constructor() {
    for (const value of createIterable()) return;
  }
});
attempt("return 1 in for-of in try", class B extends A {
  constructor() {
    super();
    try {
      for (const value of createIterable()) return value;
    } catch (e) {
      console.log("caught");
    }
  }
});
attempt("super() when the iterator is closed", class B extends A {
  constructor() {
    const iterable = {
      [Symbol.iterator]: () => ({
        next: () => ({ done: false, value: 1 }),
        return: () => {
          super();
          return {};
        },
      }),
    };
    for (const value of iterable) return;
  }
});

function constructInTry(Class) {
  try {
    return typeof new Class();
  } catch (error) {
    return "the caller catches " + error.name;
  }
}
class ReturnsNumber extends A {
  constructor(value) {
    super();
    try {
      if (value % 2) return value;
    } catch (e) {
      console.log("caught");
    }
  }
}
console.log(constructInTry(ReturnsNumber), steps.splice(0).join());
let thrown = 0;
let constructed = 0;
for (let i = 0; i < 1000; i++) {
  try {
    new ReturnsNumber(i);
    constructed++;
  } catch (error) {
    if (error instanceof TypeError) thrown++;
  }
}
console.log(constructed, thrown, steps.splice(0).length);

class Base {
  constructor() {
    try {
      return 1;
    } catch (e) {
      console.log("caught");
    }
  }
}
console.log("a base constructor ignores the number:", new Base() instanceof Base);
console.log("Reflect.construct:", constructInTry(function () { return Reflect.construct(ReturnsNumber, [1], A); }), steps.splice(0).join());
