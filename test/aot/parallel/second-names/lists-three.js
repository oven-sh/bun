// An object gets a second name (lists), is read, is changed under the second name, and is read again under the first.
{
  console.log("# road-spread-call.change-other-kind");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same(...[made]);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-spread-call.change-prototype");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same(...[made]);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-spread-call.change-store");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same(...[made]);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-spread-call");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same(...[made]);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-spread-list.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...[made]][0];
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
  console.log("# road-spread-list.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...[made]][0];
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
  console.log("# road-spread-list.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...[made]][0];
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
  console.log("# road-spread-list.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...[made]][0];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-spread-list.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...[made]][0];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-spread-list.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...[made]][0];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-spread-list.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...[made]][0];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-spread-list");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...[made]][0];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-stored-at-length.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => ((l[l.length] = made), l[l.length - 1]))([1, 2]);
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
  console.log("# road-stored-at-length.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => ((l[l.length] = made), l[l.length - 1]))([1, 2]);
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
  console.log("# road-stored-at-length.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => ((l[l.length] = made), l[l.length - 1]))([1, 2]);
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
  console.log("# road-stored-at-length.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => ((l[l.length] = made), l[l.length - 1]))([1, 2]);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-stored-at-length.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => ((l[l.length] = made), l[l.length - 1]))([1, 2]);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-stored-at-length.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => ((l[l.length] = made), l[l.length - 1]))([1, 2]);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-stored-at-length.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => ((l[l.length] = made), l[l.length - 1]))([1, 2]);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-stored-at-length");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => ((l[l.length] = made), l[l.length - 1]))([1, 2]);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-swap-pattern.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let a = made,
        b = null;
      [a, b] = [b, a];
      return b;
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
  console.log("# road-swap-pattern.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let a = made,
        b = null;
      [a, b] = [b, a];
      return b;
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
  console.log("# road-swap-pattern.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let a = made,
        b = null;
      [a, b] = [b, a];
      return b;
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
  console.log("# road-swap-pattern.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let a = made,
        b = null;
      [a, b] = [b, a];
      return b;
    })();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-swap-pattern.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let a = made,
        b = null;
      [a, b] = [b, a];
      return b;
    })();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-swap-pattern.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let a = made,
        b = null;
      [a, b] = [b, a];
      return b;
    })();
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-swap-pattern.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let a = made,
        b = null;
      [a, b] = [b, a];
      return b;
    })();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-swap-pattern");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let a = made,
        b = null;
      [a, b] = [b, a];
      return b;
    })();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-symbol-iterator.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made][Symbol.iterator]().next().value;
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
  console.log("# road-symbol-iterator.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made][Symbol.iterator]().next().value;
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
  console.log("# road-symbol-iterator.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made][Symbol.iterator]().next().value;
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
  console.log("# road-symbol-iterator.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made][Symbol.iterator]().next().value;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-symbol-iterator.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made][Symbol.iterator]().next().value;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-symbol-iterator.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made][Symbol.iterator]().next().value;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-symbol-iterator.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made][Symbol.iterator]().next().value;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-symbol-iterator");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made][Symbol.iterator]().next().value;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-to-reversed.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].toReversed()[0];
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
  console.log("# road-to-reversed.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].toReversed()[0];
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
  console.log("# road-to-reversed.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].toReversed()[0];
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
  console.log("# road-to-reversed.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].toReversed()[0];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-to-reversed.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].toReversed()[0];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-to-reversed.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].toReversed()[0];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-to-reversed.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].toReversed()[0];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-to-reversed");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].toReversed()[0];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-to-sorted.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].toSorted()[0];
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
  console.log("# road-to-sorted.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].toSorted()[0];
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
  console.log("# road-to-sorted.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].toSorted()[0];
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
  console.log("# road-to-sorted.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].toSorted()[0];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-to-sorted.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].toSorted()[0];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-to-sorted.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].toSorted()[0];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-to-sorted.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].toSorted()[0];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-to-sorted");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].toSorted()[0];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-to-spliced.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0].toSpliced(0, 1, made)[0];
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
  console.log("# road-to-spliced.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0].toSpliced(0, 1, made)[0];
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
  console.log("# road-to-spliced.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0].toSpliced(0, 1, made)[0];
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
  console.log("# road-to-spliced.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0].toSpliced(0, 1, made)[0];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-to-spliced.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0].toSpliced(0, 1, made)[0];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-to-spliced.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0].toSpliced(0, 1, made)[0];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-to-spliced.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0].toSpliced(0, 1, made)[0];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-to-spliced");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0].toSpliced(0, 1, made)[0];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-unshifted.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => (l.unshift(made), l[0]))([1]);
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
  console.log("# road-unshifted.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => (l.unshift(made), l[0]))([1]);
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
  console.log("# road-unshifted.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => (l.unshift(made), l[0]))([1]);
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
  console.log("# road-unshifted.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => (l.unshift(made), l[0]))([1]);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-unshifted.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => (l.unshift(made), l[0]))([1]);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-unshifted.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => (l.unshift(made), l[0]))([1]);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-unshifted.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => (l.unshift(made), l[0]))([1]);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-unshifted");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => (l.unshift(made), l[0]))([1]);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-with.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0].with(0, made)[0];
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
  console.log("# road-with.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0].with(0, made)[0];
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
  console.log("# road-with.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0].with(0, made)[0];
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
  console.log("# road-with.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0].with(0, made)[0];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-with.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0].with(0, made)[0];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-with.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0].with(0, made)[0];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-with.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0].with(0, made)[0];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-with");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0].with(0, made)[0];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
