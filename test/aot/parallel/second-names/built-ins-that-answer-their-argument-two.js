// An object gets a second name (built ins that answer their argument), is read, is changed under the second name, and is read again under the first.
{
  console.log("# road-reflect-get-receiver.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Reflect.get(
      {
        get a() {
          return this;
        },
      },
      "a",
      made,
    );
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
  console.log("# road-reflect-get-receiver.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Reflect.get(
      {
        get a() {
          return this;
        },
      },
      "a",
      made,
    );
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-reflect-get-receiver.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Reflect.get(
      {
        get a() {
          return this;
        },
      },
      "a",
      made,
    );
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-reflect-get-receiver.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Reflect.get(
      {
        get a() {
          return this;
        },
      },
      "a",
      made,
    );
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-reflect-get-receiver.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Reflect.get(
      {
        get a() {
          return this;
        },
      },
      "a",
      made,
    );
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-reflect-get-receiver");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Reflect.get(
      {
        get a() {
          return this;
        },
      },
      "a",
      made,
    );
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-reflect-prototype.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Reflect.getPrototypeOf(Object.create(made));
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
  console.log("# road-reflect-prototype.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Reflect.getPrototypeOf(Object.create(made));
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
  console.log("# road-reflect-prototype.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Reflect.getPrototypeOf(Object.create(made));
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
  console.log("# road-reflect-prototype.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Reflect.getPrototypeOf(Object.create(made));
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-reflect-prototype.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Reflect.getPrototypeOf(Object.create(made));
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-reflect-prototype.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Reflect.getPrototypeOf(Object.create(made));
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-reflect-prototype.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Reflect.getPrototypeOf(Object.create(made));
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-reflect-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Reflect.getPrototypeOf(Object.create(made));
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-prototype-of.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.setPrototypeOf(made, Object.getPrototypeOf(made));
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
  console.log("# road-set-prototype-of.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.setPrototypeOf(made, Object.getPrototypeOf(made));
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
  console.log("# road-set-prototype-of.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.setPrototypeOf(made, Object.getPrototypeOf(made));
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
  console.log("# road-set-prototype-of.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.setPrototypeOf(made, Object.getPrototypeOf(made));
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-prototype-of.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.setPrototypeOf(made, Object.getPrototypeOf(made));
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-prototype-of.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.setPrototypeOf(made, Object.getPrototypeOf(made));
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-prototype-of.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.setPrototypeOf(made, Object.getPrototypeOf(made));
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-prototype-of");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.setPrototypeOf(made, Object.getPrototypeOf(made));
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-value-of.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.prototype.valueOf.call(made);
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
  console.log("# road-value-of.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.prototype.valueOf.call(made);
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
  console.log("# road-value-of.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.prototype.valueOf.call(made);
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
  console.log("# road-value-of.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.prototype.valueOf.call(made);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-value-of.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.prototype.valueOf.call(made);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-value-of.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.prototype.valueOf.call(made);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-value-of.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.prototype.valueOf.call(made);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-value-of");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.prototype.valueOf.call(made);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
