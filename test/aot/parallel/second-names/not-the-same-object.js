// An object gets a second name (not the same object), is read, is changed under the second name, and is read again under the first.
{
  console.log("# road-child-create.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create(made);
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
  console.log("# road-child-create.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create(made);
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
  console.log("# road-child-create.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create(made);
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
  console.log("# road-child-create.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create(made);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-child-create.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create(made);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-child-create.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create(made);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-child-create.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create(made);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-child-create");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create(made);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-child-literal.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { __proto__: made };
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
  console.log("# road-child-literal.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { __proto__: made };
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
  console.log("# road-child-literal.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { __proto__: made };
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
  console.log("# road-child-literal.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { __proto__: made };
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-child-literal.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { __proto__: made };
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-child-literal.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { __proto__: made };
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-child-literal.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { __proto__: made };
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-child-literal");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { __proto__: made };
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-child-set-prototype.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.setPrototypeOf({}, made);
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
  console.log("# road-child-set-prototype.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.setPrototypeOf({}, made);
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
  console.log("# road-child-set-prototype.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.setPrototypeOf({}, made);
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
  console.log("# road-child-set-prototype.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.setPrototypeOf({}, made);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-child-set-prototype.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.setPrototypeOf({}, made);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-child-set-prototype.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.setPrototypeOf({}, made);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-child-set-prototype.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.setPrototypeOf({}, made);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-child-set-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.setPrototypeOf({}, made);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-copy-assign.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.assign({}, made);
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
  console.log("# road-copy-assign.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.assign({}, made);
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
  console.log("# road-copy-assign.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.assign({}, made);
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
  console.log("# road-copy-assign.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.assign({}, made);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-copy-assign.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.assign({}, made);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-copy-assign.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.assign({}, made);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-copy-assign.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.assign({}, made);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-copy-assign");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.assign({}, made);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-copy-entries.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.fromEntries(Object.entries(made));
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
  console.log("# road-copy-entries.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.fromEntries(Object.entries(made));
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
  console.log("# road-copy-entries.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.fromEntries(Object.entries(made));
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
  console.log("# road-copy-entries.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.fromEntries(Object.entries(made));
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-copy-entries.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.fromEntries(Object.entries(made));
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-copy-entries.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.fromEntries(Object.entries(made));
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-copy-entries.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.fromEntries(Object.entries(made));
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-copy-entries");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.fromEntries(Object.entries(made));
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-copy-json.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = JSON.parse(JSON.stringify(made));
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
  console.log("# road-copy-json.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = JSON.parse(JSON.stringify(made));
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
  console.log("# road-copy-json.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = JSON.parse(JSON.stringify(made));
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
  console.log("# road-copy-json.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = JSON.parse(JSON.stringify(made));
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-copy-json.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = JSON.parse(JSON.stringify(made));
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-copy-json.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = JSON.parse(JSON.stringify(made));
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-copy-json.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = JSON.parse(JSON.stringify(made));
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-copy-json");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = JSON.parse(JSON.stringify(made));
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-copy-spread.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { ...made };
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
  console.log("# road-copy-spread.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { ...made };
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
  console.log("# road-copy-spread.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { ...made };
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
  console.log("# road-copy-spread.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { ...made };
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-copy-spread.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { ...made };
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-copy-spread.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { ...made };
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-copy-spread.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { ...made };
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-copy-spread");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { ...made };
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-copy-structured.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = structuredClone({ count: made.count, label: made.label, inner: made.inner });
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
  console.log("# road-copy-structured.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = structuredClone({ count: made.count, label: made.label, inner: made.inner });
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
  console.log("# road-copy-structured.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = structuredClone({ count: made.count, label: made.label, inner: made.inner });
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
  console.log("# road-copy-structured.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = structuredClone({ count: made.count, label: made.label, inner: made.inner });
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-copy-structured.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = structuredClone({ count: made.count, label: made.label, inner: made.inner });
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-copy-structured.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = structuredClone({ count: made.count, label: made.label, inner: made.inner });
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-copy-structured.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = structuredClone({ count: made.count, label: made.label, inner: made.inner });
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-copy-structured");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = structuredClone({ count: made.count, label: made.label, inner: made.inner });
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
