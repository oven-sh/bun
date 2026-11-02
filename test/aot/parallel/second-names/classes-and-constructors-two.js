// An object gets a second name (classes and constructors), is read, is changed under the second name, and is read again under the first.
{
  console.log("# road-static-getter.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = class {
      static get held() {
        return made;
      }
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
  console.log("# road-static-getter.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = class {
      static get held() {
        return made;
      }
    }.held;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-static-getter.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = class {
      static get held() {
        return made;
      }
    }.held;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-static-getter.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = class {
      static get held() {
        return made;
      }
    }.held;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-static-getter.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = class {
      static get held() {
        return made;
      }
    }.held;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-static-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = class {
      static get held() {
        return made;
      }
    }.held;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-static-private.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = class C {
      static #held = made;
      static get() {
        return C.#held;
      }
    }.get();
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
  console.log("# road-static-private.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = class C {
      static #held = made;
      static get() {
        return C.#held;
      }
    }.get();
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
  console.log("# road-static-private.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = class C {
      static #held = made;
      static get() {
        return C.#held;
      }
    }.get();
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
  console.log("# road-static-private.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = class C {
      static #held = made;
      static get() {
        return C.#held;
      }
    }.get();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-static-private.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = class C {
      static #held = made;
      static get() {
        return C.#held;
      }
    }.get();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-static-private.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = class C {
      static #held = made;
      static get() {
        return C.#held;
      }
    }.get();
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-static-private.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = class C {
      static #held = made;
      static get() {
        return C.#held;
      }
    }.get();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-static-private");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = class C {
      static #held = made;
      static get() {
        return C.#held;
      }
    }.get();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-super-method.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class {
      me() {
        return made;
      }
    } {
      get() {
        return super.me();
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
  console.log("# road-super-method.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class {
      me() {
        return made;
      }
    } {
      get() {
        return super.me();
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
  console.log("# road-super-method.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class {
      me() {
        return made;
      }
    } {
      get() {
        return super.me();
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
  console.log("# road-super-method.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class {
      me() {
        return made;
      }
    } {
      get() {
        return super.me();
      }
    })().get();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-super-method.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class {
      me() {
        return made;
      }
    } {
      get() {
        return super.me();
      }
    })().get();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-super-method.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class {
      me() {
        return made;
      }
    } {
      get() {
        return super.me();
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
  console.log("# road-super-method.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class {
      me() {
        return made;
      }
    } {
      get() {
        return super.me();
      }
    })().get();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-super-method");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new (class extends class {
      me() {
        return made;
      }
    } {
      get() {
        return super.me();
      }
    })().get();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-super-property.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = {
      __proto__: {
        get me() {
          return made;
        },
      },
      get() {
        return super.me;
      },
    }.get();
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
  console.log("# road-super-property.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = {
      __proto__: {
        get me() {
          return made;
        },
      },
      get() {
        return super.me;
      },
    }.get();
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
  console.log("# road-super-property.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = {
      __proto__: {
        get me() {
          return made;
        },
      },
      get() {
        return super.me;
      },
    }.get();
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
  console.log("# road-super-property.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = {
      __proto__: {
        get me() {
          return made;
        },
      },
      get() {
        return super.me;
      },
    }.get();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-super-property.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = {
      __proto__: {
        get me() {
          return made;
        },
      },
      get() {
        return super.me;
      },
    }.get();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-super-property.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = {
      __proto__: {
        get me() {
          return made;
        },
      },
      get() {
        return super.me;
      },
    }.get();
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-super-property.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = {
      __proto__: {
        get me() {
          return made;
        },
      },
      get() {
        return super.me;
      },
    }.get();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-super-property");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = {
      __proto__: {
        get me() {
          return made;
        },
      },
      get() {
        return super.me;
      },
    }.get();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
