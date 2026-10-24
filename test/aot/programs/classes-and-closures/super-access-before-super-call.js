// Before `super()` has returned, a store to a super property runs its key and its value and then throws. A read or a call throws before its key runs.
const steps = [];
function step(name, value) {
  steps.push(name);
  return value;
}
class Base {
  get x() {
    steps.push("getter");
    return 1;
  }
  set x(value) {
    steps.push("setter");
  }
  method() {
    steps.push("method");
  }
}
function attempt(title, Class) {
  let outcome = "constructed";
  try {
    new Class();
  } catch (error) {
    outcome = error.name;
  }
  console.log(`${title}: ${outcome}`, JSON.stringify(steps.splice(0)));
}

attempt("store by name", class extends Base {
  constructor() {
    super.x = step("value", 1);
    super();
  }
});
attempt("store by key", class extends Base {
  constructor() {
    super[step("key", "x")] = step("value", 1);
    super();
  }
});
attempt("read by name", class extends Base {
  constructor() {
    super.x;
    super();
  }
});
attempt("read by key", class extends Base {
  constructor() {
    super[step("key", "x")];
    super();
  }
});
attempt("call by name", class extends Base {
  constructor() {
    super.method(step("argument"));
    super();
  }
});
attempt("call by key", class extends Base {
  constructor() {
    super[step("key", "method")](step("argument"));
    super();
  }
});
attempt("update by name", class extends Base {
  constructor() {
    super.x += step("value", 1);
    super();
  }
});
attempt("update by key", class extends Base {
  constructor() {
    super[step("key", "x")] += step("value", 1);
    super();
  }
});
attempt("increment by key", class extends Base {
  constructor() {
    super[step("key", "x")]++;
    super();
  }
});
attempt("logical assignment", class extends Base {
  constructor() {
    super.x &&= step("value", 1);
    super();
  }
});
attempt("array pattern", class extends Base {
  constructor() {
    [super.x] = step("value", [1]);
    super();
  }
});
attempt("object pattern", class extends Base {
  constructor() {
    ({ a: super[step("key", "x")] } = step("value", { a: 1 }));
    super();
  }
});
attempt("head of for-of", class extends Base {
  constructor() {
    for (super.x of step("value", [1]));
    super();
  }
});
attempt("store in an arrow function", class extends Base {
  constructor() {
    const store = () => {
      super.x = step("value", 1);
    };
    store();
    super();
  }
});
attempt("store after a super() that was skipped", class extends Base {
  constructor() {
    if (step("condition", false)) super();
    super.x = step("value", 1);
  }
});
attempt("store after super()", class extends Base {
  constructor() {
    super();
    super[step("key", "x")] = step("value", 1);
  }
});
attempt("update after super()", class extends Base {
  constructor() {
    super();
    super[step("key", "x")] += step("value", 1);
  }
});
