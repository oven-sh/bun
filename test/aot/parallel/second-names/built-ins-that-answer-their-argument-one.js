// An object gets a second name (built ins that answer their argument), is read, is changed under the second name, and is read again under the first.
{
  console.log("# road-assign-target-empty.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.assign(made, {});
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
  console.log("# road-assign-target-empty.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.assign(made, {});
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
  console.log("# road-assign-target-empty.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.assign(made, {});
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
  console.log("# road-assign-target-empty.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.assign(made, {});
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-assign-target-empty.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.assign(made, {});
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-assign-target-empty.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.assign(made, {});
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-assign-target-empty.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.assign(made, {});
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-assign-target-empty");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.assign(made, {});
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-assign-target.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.assign(made);
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
  console.log("# road-assign-target.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.assign(made);
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
  console.log("# road-assign-target.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.assign(made);
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
  console.log("# road-assign-target.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.assign(made);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-assign-target.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.assign(made);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-assign-target.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.assign(made);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-assign-target.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.assign(made);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-assign-target");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.assign(made);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-create-with-descriptor.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create(null, { a: { value: made } }).a;
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
  console.log("# road-create-with-descriptor.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create(null, { a: { value: made } }).a;
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
  console.log("# road-create-with-descriptor.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create(null, { a: { value: made } }).a;
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
  console.log("# road-create-with-descriptor.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create(null, { a: { value: made } }).a;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-create-with-descriptor.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create(null, { a: { value: made } }).a;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-create-with-descriptor.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create(null, { a: { value: made } }).a;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-create-with-descriptor.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create(null, { a: { value: made } }).a;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-create-with-descriptor");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create(null, { a: { value: made } }).a;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-define-properties.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.defineProperties(made, {});
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
  console.log("# road-define-properties.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.defineProperties(made, {});
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
  console.log("# road-define-properties.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.defineProperties(made, {});
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
  console.log("# road-define-properties.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.defineProperties(made, {});
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-define-properties.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.defineProperties(made, {});
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-define-properties.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.defineProperties(made, {});
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-define-properties.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.defineProperties(made, {});
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-define-properties");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.defineProperties(made, {});
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-define-property.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.defineProperty(made, "count", { value: 1 });
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
  console.log("# road-define-property.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.defineProperty(made, "count", { value: 1 });
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
  console.log("# road-define-property.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.defineProperty(made, "count", { value: 1 });
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
  console.log("# road-define-property.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.defineProperty(made, "count", { value: 1 });
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-define-property.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.defineProperty(made, "count", { value: 1 });
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-define-property.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.defineProperty(made, "count", { value: 1 });
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-define-property.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.defineProperty(made, "count", { value: 1 });
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-define-property");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.defineProperty(made, "count", { value: 1 });
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-descriptor.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getOwnPropertyDescriptor({ a: made }, "a").value;
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
  console.log("# road-descriptor.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getOwnPropertyDescriptor({ a: made }, "a").value;
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
  console.log("# road-descriptor.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getOwnPropertyDescriptor({ a: made }, "a").value;
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
  console.log("# road-descriptor.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getOwnPropertyDescriptor({ a: made }, "a").value;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-descriptor.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getOwnPropertyDescriptor({ a: made }, "a").value;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-descriptor.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getOwnPropertyDescriptor({ a: made }, "a").value;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-descriptor.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getOwnPropertyDescriptor({ a: made }, "a").value;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-descriptor");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getOwnPropertyDescriptor({ a: made }, "a").value;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-descriptors.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getOwnPropertyDescriptors({ a: made }).a.value;
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
  console.log("# road-descriptors.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getOwnPropertyDescriptors({ a: made }).a.value;
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
  console.log("# road-descriptors.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getOwnPropertyDescriptors({ a: made }).a.value;
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
  console.log("# road-descriptors.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getOwnPropertyDescriptors({ a: made }).a.value;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-descriptors.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getOwnPropertyDescriptors({ a: made }).a.value;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-descriptors.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getOwnPropertyDescriptors({ a: made }).a.value;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-descriptors.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getOwnPropertyDescriptors({ a: made }).a.value;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-descriptors");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getOwnPropertyDescriptors({ a: made }).a.value;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-entries-pair.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.entries({ a: made })[0][1];
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
  console.log("# road-entries-pair.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.entries({ a: made })[0][1];
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
  console.log("# road-entries-pair.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.entries({ a: made })[0][1];
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
  console.log("# road-entries-pair.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.entries({ a: made })[0][1];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-entries-pair.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.entries({ a: made })[0][1];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-entries-pair.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.entries({ a: made })[0][1];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-entries-pair.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.entries({ a: made })[0][1];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-entries-pair");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.entries({ a: made })[0][1];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-from-entries.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.fromEntries([["a", made]]).a;
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
  console.log("# road-from-entries.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.fromEntries([["a", made]]).a;
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
  console.log("# road-from-entries.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.fromEntries([["a", made]]).a;
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
  console.log("# road-from-entries.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.fromEntries([["a", made]]).a;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-from-entries.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.fromEntries([["a", made]]).a;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-from-entries.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.fromEntries([["a", made]]).a;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-from-entries.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.fromEntries([["a", made]]).a;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-from-entries");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.fromEntries([["a", made]]).a;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-group-by.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.groupBy([made], () => "k").k[0];
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
  console.log("# road-group-by.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.groupBy([made], () => "k").k[0];
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
  console.log("# road-group-by.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.groupBy([made], () => "k").k[0];
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
  console.log("# road-group-by.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.groupBy([made], () => "k").k[0];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-group-by.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.groupBy([made], () => "k").k[0];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-group-by.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.groupBy([made], () => "k").k[0];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-group-by.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.groupBy([made], () => "k").k[0];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-group-by");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.groupBy([made], () => "k").k[0];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-inherited-read.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create({ a: made }).a;
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
  console.log("# road-inherited-read.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create({ a: made }).a;
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
  console.log("# road-inherited-read.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create({ a: made }).a;
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
  console.log("# road-inherited-read.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create({ a: made }).a;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-inherited-read.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create({ a: made }).a;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-inherited-read.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create({ a: made }).a;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-inherited-read.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create({ a: made }).a;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-inherited-read");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create({ a: made }).a;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-group-by.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Map.groupBy([made], () => 1).get(1)[0];
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
  console.log("# road-map-group-by.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Map.groupBy([made], () => 1).get(1)[0];
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
  console.log("# road-map-group-by.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Map.groupBy([made], () => 1).get(1)[0];
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
  console.log("# road-map-group-by.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Map.groupBy([made], () => 1).get(1)[0];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-group-by.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Map.groupBy([made], () => 1).get(1)[0];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-group-by.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Map.groupBy([made], () => 1).get(1)[0];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-group-by.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Map.groupBy([made], () => 1).get(1)[0];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-group-by");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Map.groupBy([made], () => 1).get(1)[0];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-new-object.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Object(made);
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
  console.log("# road-new-object.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Object(made);
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
  console.log("# road-new-object.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Object(made);
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
  console.log("# road-new-object.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Object(made);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-new-object.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Object(made);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-new-object.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Object(made);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-new-object.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Object(made);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-new-object");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Object(made);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proto-of-child.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create(made).__proto__;
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
  console.log("# road-proto-of-child.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create(made).__proto__;
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
  console.log("# road-proto-of-child.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create(made).__proto__;
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
  console.log("# road-proto-of-child.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create(made).__proto__;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proto-of-child.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create(made).__proto__;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proto-of-child.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create(made).__proto__;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proto-of-child.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create(made).__proto__;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proto-of-child");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.create(made).__proto__;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proto-of-literal.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getPrototypeOf({ __proto__: made });
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
  console.log("# road-proto-of-literal.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getPrototypeOf({ __proto__: made });
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
  console.log("# road-proto-of-literal.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getPrototypeOf({ __proto__: made });
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
  console.log("# road-proto-of-literal.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getPrototypeOf({ __proto__: made });
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proto-of-literal.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getPrototypeOf({ __proto__: made });
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proto-of-literal.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getPrototypeOf({ __proto__: made });
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proto-of-literal.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getPrototypeOf({ __proto__: made });
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proto-of-literal");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getPrototypeOf({ __proto__: made });
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-prototype-of-child.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getPrototypeOf(Object.create(made));
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
  console.log("# road-prototype-of-child.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getPrototypeOf(Object.create(made));
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
  console.log("# road-prototype-of-child.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getPrototypeOf(Object.create(made));
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
  console.log("# road-prototype-of-child.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getPrototypeOf(Object.create(made));
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-prototype-of-child.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getPrototypeOf(Object.create(made));
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-prototype-of-child.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getPrototypeOf(Object.create(made));
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-prototype-of-child.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getPrototypeOf(Object.create(made));
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-prototype-of-child");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Object.getPrototypeOf(Object.create(made));
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-reflect-get-receiver.change-freeze");
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
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-reflect-get-receiver.change-getter");
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
