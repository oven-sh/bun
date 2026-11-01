// An object gets a second name (maps and sets), is read, is changed under the second name, and is read again under the first.
{
  console.log("# road-set-union.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set([made]).union(new Set())][0];
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
  console.log("# road-set-union.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set([made]).union(new Set())][0];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-union.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set([made]).union(new Set())][0];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-union.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set([made]).union(new Set())][0];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-union.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set([made]).union(new Set())][0];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-union");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set([made]).union(new Set())][0];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-values.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Set([made]).values().next().value;
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
  console.log("# road-set-values.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Set([made]).values().next().value;
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
  console.log("# road-set-values.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Set([made]).values().next().value;
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
  console.log("# road-set-values.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Set([made]).values().next().value;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-values.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Set([made]).values().next().value;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-values.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Set([made]).values().next().value;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-values.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Set([made]).values().next().value;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-values");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Set([made]).values().next().value;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-spread-map.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Map([[1, made]])][0][1];
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
  console.log("# road-spread-map.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Map([[1, made]])][0][1];
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
  console.log("# road-spread-map.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Map([[1, made]])][0][1];
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
  console.log("# road-spread-map.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Map([[1, made]])][0][1];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-spread-map.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Map([[1, made]])][0][1];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-spread-map.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Map([[1, made]])][0][1];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-spread-map.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Map([[1, made]])][0][1];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-spread-map");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Map([[1, made]])][0][1];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-weak-map-own-key.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new WeakMap([[made, made]]).get(made);
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
  console.log("# road-weak-map-own-key.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new WeakMap([[made, made]]).get(made);
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
  console.log("# road-weak-map-own-key.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new WeakMap([[made, made]]).get(made);
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
  console.log("# road-weak-map-own-key.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new WeakMap([[made, made]]).get(made);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-weak-map-own-key.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new WeakMap([[made, made]]).get(made);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-weak-map-own-key.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new WeakMap([[made, made]]).get(made);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-weak-map-own-key.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new WeakMap([[made, made]]).get(made);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-weak-map-own-key");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new WeakMap([[made, made]]).get(made);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-weak-map.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (k => new WeakMap([[k, made]]).get(k))({});
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
  console.log("# road-weak-map.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (k => new WeakMap([[k, made]]).get(k))({});
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
  console.log("# road-weak-map.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (k => new WeakMap([[k, made]]).get(k))({});
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
  console.log("# road-weak-map.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (k => new WeakMap([[k, made]]).get(k))({});
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-weak-map.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (k => new WeakMap([[k, made]]).get(k))({});
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-weak-map.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (k => new WeakMap([[k, made]]).get(k))({});
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-weak-map.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (k => new WeakMap([[k, made]]).get(k))({});
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-weak-map");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (k => new WeakMap([[k, made]]).get(k))({});
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
