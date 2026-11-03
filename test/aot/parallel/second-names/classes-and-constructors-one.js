// An object gets a second name (classes and constructors), is read, is changed under the second name, and is read again under the first.
{
  console.log("# road-class-getter.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      get held() {
        return made;
      }
    })().held;
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-class-getter.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      get held() {
        return made;
      }
    })().held;
    const before = [made.label];
    Object.defineProperty(again, "count", {
      get() {
        return 9;
      },
      enumerable: true,
      configurable: true,
    });
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-class-getter.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      get held() {
        return made;
      }
    })().held;
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-class-getter.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      get held() {
        return made;
      }
    })().held;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-class-getter.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      get held() {
        return made;
      }
    })().held;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-class-getter.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      get held() {
        return made;
      }
    })().held;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-class-getter.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      get held() {
        return made;
      }
    })().held;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-class-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      get held() {
        return made;
      }
    })().held;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-constructor-argument.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      constructor(x) {
        this.x = x;
      }
    })(made).x;
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-constructor-argument.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      constructor(x) {
        this.x = x;
      }
    })(made).x;
    const before = [made.label];
    Object.defineProperty(again, "count", {
      get() {
        return 9;
      },
      enumerable: true,
      configurable: true,
    });
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-constructor-argument.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      constructor(x) {
        this.x = x;
      }
    })(made).x;
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-constructor-argument.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      constructor(x) {
        this.x = x;
      }
    })(made).x;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-constructor-argument.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      constructor(x) {
        this.x = x;
      }
    })(made).x;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-constructor-argument.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      constructor(x) {
        this.x = x;
      }
    })(made).x;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-constructor-argument.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      constructor(x) {
        this.x = x;
      }
    })(made).x;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-constructor-argument");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      constructor(x) {
        this.x = x;
      }
    })(made).x;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-derived-field-on-it.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class {
      constructor() {
        return made;
      }
    } {
      constructor() {
        super();
        return this;
      }
    })();
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-derived-field-on-it.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class {
      constructor() {
        return made;
      }
    } {
      constructor() {
        super();
        return this;
      }
    })();
    const before = [made.label];
    Object.defineProperty(again, "count", {
      get() {
        return 9;
      },
      enumerable: true,
      configurable: true,
    });
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-derived-field-on-it.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class {
      constructor() {
        return made;
      }
    } {
      constructor() {
        super();
        return this;
      }
    })();
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-derived-field-on-it.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class {
      constructor() {
        return made;
      }
    } {
      constructor() {
        super();
        return this;
      }
    })();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-derived-field-on-it.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class {
      constructor() {
        return made;
      }
    } {
      constructor() {
        super();
        return this;
      }
    })();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-derived-field-on-it.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class {
      constructor() {
        return made;
      }
    } {
      constructor() {
        super();
        return this;
      }
    })();
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-derived-field-on-it.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class {
      constructor() {
        return made;
      }
    } {
      constructor() {
        super();
        return this;
      }
    })();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-derived-field-on-it");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class {
      constructor() {
        return made;
      }
    } {
      constructor() {
        super();
        return this;
      }
    })();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-derived-returns.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends Object {
      constructor() {
        super();
        return made;
      }
    })();
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-derived-returns.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends Object {
      constructor() {
        super();
        return made;
      }
    })();
    const before = [made.label];
    Object.defineProperty(again, "count", {
      get() {
        return 9;
      },
      enumerable: true,
      configurable: true,
    });
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-derived-returns.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends Object {
      constructor() {
        super();
        return made;
      }
    })();
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-derived-returns.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends Object {
      constructor() {
        super();
        return made;
      }
    })();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-derived-returns.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends Object {
      constructor() {
        super();
        return made;
      }
    })();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-derived-returns.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends Object {
      constructor() {
        super();
        return made;
      }
    })();
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-derived-returns.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends Object {
      constructor() {
        super();
        return made;
      }
    })();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-derived-returns");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends Object {
      constructor() {
        super();
        return made;
      }
    })();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-derived-twice.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class extends class {
      constructor() {
        return made;
      }
    } {} {})();
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-derived-twice.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class extends class {
      constructor() {
        return made;
      }
    } {} {})();
    const before = [made.label];
    Object.defineProperty(again, "count", {
      get() {
        return 9;
      },
      enumerable: true,
      configurable: true,
    });
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-derived-twice.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class extends class {
      constructor() {
        return made;
      }
    } {} {})();
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-derived-twice.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class extends class {
      constructor() {
        return made;
      }
    } {} {})();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-derived-twice.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class extends class {
      constructor() {
        return made;
      }
    } {} {})();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-derived-twice.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class extends class {
      constructor() {
        return made;
      }
    } {} {})();
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-derived-twice.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class extends class {
      constructor() {
        return made;
      }
    } {} {})();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-derived-twice");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class extends class {
      constructor() {
        return made;
      }
    } {} {})();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-field-from-argument.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class {
      constructor(x) {
        this.x = x;
      }
    } {})(made).x;
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-field-from-argument.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class {
      constructor(x) {
        this.x = x;
      }
    } {})(made).x;
    const before = [made.label];
    Object.defineProperty(again, "count", {
      get() {
        return 9;
      },
      enumerable: true,
      configurable: true,
    });
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-field-from-argument.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class {
      constructor(x) {
        this.x = x;
      }
    } {})(made).x;
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-field-from-argument.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class {
      constructor(x) {
        this.x = x;
      }
    } {})(made).x;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-field-from-argument.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class {
      constructor(x) {
        this.x = x;
      }
    } {})(made).x;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-field-from-argument.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class {
      constructor(x) {
        this.x = x;
      }
    } {})(made).x;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-field-from-argument.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class {
      constructor(x) {
        this.x = x;
      }
    } {})(made).x;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-field-from-argument");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class {
      constructor(x) {
        this.x = x;
      }
    } {})(made).x;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-instance-field.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      held = made;
    })().held;
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-instance-field.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      held = made;
    })().held;
    const before = [made.label];
    Object.defineProperty(again, "count", {
      get() {
        return 9;
      },
      enumerable: true,
      configurable: true,
    });
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-instance-field.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      held = made;
    })().held;
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-instance-field.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      held = made;
    })().held;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-instance-field.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      held = made;
    })().held;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-instance-field.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      held = made;
    })().held;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-instance-field.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      held = made;
    })().held;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-instance-field");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      held = made;
    })().held;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-literal-getter.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = {
      get held() {
        return made;
      },
    }.held;
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-literal-getter.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = {
      get held() {
        return made;
      },
    }.held;
    const before = [made.label];
    Object.defineProperty(again, "count", {
      get() {
        return 9;
      },
      enumerable: true,
      configurable: true,
    });
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-literal-getter.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = {
      get held() {
        return made;
      },
    }.held;
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-literal-getter.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = {
      get held() {
        return made;
      },
    }.held;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-literal-getter.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = {
      get held() {
        return made;
      },
    }.held;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-literal-getter.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = {
      get held() {
        return made;
      },
    }.held;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-literal-getter.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = {
      get held() {
        return made;
      },
    }.held;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-literal-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = {
      get held() {
        return made;
      },
    }.held;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-new-target-holder.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (function F() {
      return new.target.held;
    },
    Object.assign(
      function F() {
        return new.target.held;
      },
      { held: made },
    ))();
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-new-target-holder.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (function F() {
      return new.target.held;
    },
    Object.assign(
      function F() {
        return new.target.held;
      },
      { held: made },
    ))();
    const before = [made.label];
    Object.defineProperty(again, "count", {
      get() {
        return 9;
      },
      enumerable: true,
      configurable: true,
    });
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-new-target-holder.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (function F() {
      return new.target.held;
    },
    Object.assign(
      function F() {
        return new.target.held;
      },
      { held: made },
    ))();
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-new-target-holder.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (function F() {
      return new.target.held;
    },
    Object.assign(
      function F() {
        return new.target.held;
      },
      { held: made },
    ))();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-new-target-holder.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (function F() {
      return new.target.held;
    },
    Object.assign(
      function F() {
        return new.target.held;
      },
      { held: made },
    ))();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-new-target-holder.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (function F() {
      return new.target.held;
    },
    Object.assign(
      function F() {
        return new.target.held;
      },
      { held: made },
    ))();
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-new-target-holder.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (function F() {
      return new.target.held;
    },
    Object.assign(
      function F() {
        return new.target.held;
      },
      { held: made },
    ))();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-new-target-holder");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (function F() {
      return new.target.held;
    },
    Object.assign(
      function F() {
        return new.target.held;
      },
      { held: made },
    ))();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-private-field.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      #held = made;
      get() {
        return this.#held;
      }
    })().get();
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-private-field.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      #held = made;
      get() {
        return this.#held;
      }
    })().get();
    const before = [made.label];
    Object.defineProperty(again, "count", {
      get() {
        return 9;
      },
      enumerable: true,
      configurable: true,
    });
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-private-field.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      #held = made;
      get() {
        return this.#held;
      }
    })().get();
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-private-field.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      #held = made;
      get() {
        return this.#held;
      }
    })().get();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-private-field.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      #held = made;
      get() {
        return this.#held;
      }
    })().get();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-private-field.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      #held = made;
      get() {
        return this.#held;
      }
    })().get();
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-private-field.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      #held = made;
      get() {
        return this.#held;
      }
    })().get();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-private-field");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      #held = made;
      get() {
        return this.#held;
      }
    })().get();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-reflect-construct.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Reflect.construct(function () {
      return made;
    }, []);
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-reflect-construct.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Reflect.construct(function () {
      return made;
    }, []);
    const before = [made.label];
    Object.defineProperty(again, "count", {
      get() {
        return 9;
      },
      enumerable: true,
      configurable: true,
    });
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-reflect-construct.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Reflect.construct(function () {
      return made;
    }, []);
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-reflect-construct.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Reflect.construct(function () {
      return made;
    }, []);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-reflect-construct.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Reflect.construct(function () {
      return made;
    }, []);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-reflect-construct.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Reflect.construct(function () {
      return made;
    }, []);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-reflect-construct.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Reflect.construct(function () {
      return made;
    }, []);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-reflect-construct");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Reflect.construct(function () {
      return made;
    }, []);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-returning-class.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      constructor() {
        return made;
      }
    })();
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-returning-class.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      constructor() {
        return made;
      }
    })();
    const before = [made.label];
    Object.defineProperty(again, "count", {
      get() {
        return 9;
      },
      enumerable: true,
      configurable: true,
    });
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-returning-class.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      constructor() {
        return made;
      }
    })();
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-returning-class.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      constructor() {
        return made;
      }
    })();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-returning-class.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      constructor() {
        return made;
      }
    })();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-returning-class.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      constructor() {
        return made;
      }
    })();
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-returning-class.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      constructor() {
        return made;
      }
    })();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-returning-class");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class {
      constructor() {
        return made;
      }
    })();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-returning-function.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (function () {
      return made;
    })();
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-returning-function.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (function () {
      return made;
    })();
    const before = [made.label];
    Object.defineProperty(again, "count", {
      get() {
        return 9;
      },
      enumerable: true,
      configurable: true,
    });
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-returning-function.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (function () {
      return made;
    })();
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-returning-function.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (function () {
      return made;
    })();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-returning-function.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (function () {
      return made;
    })();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-returning-function.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (function () {
      return made;
    })();
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-returning-function.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (function () {
      return made;
    })();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-returning-function");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (function () {
      return made;
    })();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-setter-keeps.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      ({
        set held(v) {
          got = v;
        },
      }).held = made;
      return got;
    })();
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-setter-keeps.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      ({
        set held(v) {
          got = v;
        },
      }).held = made;
      return got;
    })();
    const before = [made.label];
    Object.defineProperty(again, "count", {
      get() {
        return 9;
      },
      enumerable: true,
      configurable: true,
    });
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-setter-keeps.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      ({
        set held(v) {
          got = v;
        },
      }).held = made;
      return got;
    })();
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-setter-keeps.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      ({
        set held(v) {
          got = v;
        },
      }).held = made;
      return got;
    })();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-setter-keeps.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      ({
        set held(v) {
          got = v;
        },
      }).held = made;
      return got;
    })();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-setter-keeps.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      ({
        set held(v) {
          got = v;
        },
      }).held = made;
      return got;
    })();
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-setter-keeps.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      ({
        set held(v) {
          got = v;
        },
      }).held = made;
      return got;
    })();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-setter-keeps");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      ({
        set held(v) {
          got = v;
        },
      }).held = made;
      return got;
    })();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-static-block.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      class C {
        static {
          got = made;
        }
      }
      return got;
    })();
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-static-block.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      class C {
        static {
          got = made;
        }
      }
      return got;
    })();
    const before = [made.label];
    Object.defineProperty(again, "count", {
      get() {
        return 9;
      },
      enumerable: true,
      configurable: true,
    });
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-static-block.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      class C {
        static {
          got = made;
        }
      }
      return got;
    })();
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-static-block.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      class C {
        static {
          got = made;
        }
      }
      return got;
    })();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-static-block.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      class C {
        static {
          got = made;
        }
      }
      return got;
    })();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-static-block.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      class C {
        static {
          got = made;
        }
      }
      return got;
    })();
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-static-block.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      class C {
        static {
          got = made;
        }
      }
      return got;
    })();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-static-block");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      class C {
        static {
          got = made;
        }
      }
      return got;
    })();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-static-field.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = class {
      static held = made;
    }.held;
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-static-field.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = class {
      static held = made;
    }.held;
    const before = [made.label];
    Object.defineProperty(again, "count", {
      get() {
        return 9;
      },
      enumerable: true,
      configurable: true,
    });
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-static-field.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = class {
      static held = made;
    }.held;
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-static-field.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = class {
      static held = made;
    }.held;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-static-field.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = class {
      static held = made;
    }.held;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-static-field.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = class {
      static held = made;
    }.held;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-static-field.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = class {
      static held = made;
    }.held;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-static-field");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = class {
      static held = made;
    }.held;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-static-getter.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = class {
      static get held() {
        return made;
      }
    }.held;
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-static-getter.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = class {
      static get held() {
        return made;
      }
    }.held;
    const before = [made.label];
    Object.defineProperty(again, "count", {
      get() {
        return 9;
      },
      enumerable: true,
      configurable: true,
    });
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
