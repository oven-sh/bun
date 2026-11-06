// An object gets a second name (iterator helpers), is read, is changed under the second name, and is read again under the first.
{
  console.log("# road-iterator-drop.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0, made].values().drop(1).next().value;
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
  console.log("# road-iterator-drop.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0, made].values().drop(1).next().value;
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
  console.log("# road-iterator-drop.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0, made].values().drop(1).next().value;
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
  console.log("# road-iterator-drop.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0, made].values().drop(1).next().value;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-drop.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0, made].values().drop(1).next().value;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-drop.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0, made].values().drop(1).next().value;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-drop.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0, made].values().drop(1).next().value;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-drop");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0, made].values().drop(1).next().value;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-filter.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made]
      .values()
      .filter(() => true)
      .next().value;
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
  console.log("# road-iterator-filter.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made]
      .values()
      .filter(() => true)
      .next().value;
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
  console.log("# road-iterator-filter.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made]
      .values()
      .filter(() => true)
      .next().value;
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
  console.log("# road-iterator-filter.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made]
      .values()
      .filter(() => true)
      .next().value;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-filter.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made]
      .values()
      .filter(() => true)
      .next().value;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-filter.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made]
      .values()
      .filter(() => true)
      .next().value;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-filter.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made]
      .values()
      .filter(() => true)
      .next().value;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-filter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made]
      .values()
      .filter(() => true)
      .next().value;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-find.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].values().find(() => true);
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
  console.log("# road-iterator-find.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].values().find(() => true);
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
  console.log("# road-iterator-find.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].values().find(() => true);
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
  console.log("# road-iterator-find.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].values().find(() => true);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-find.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].values().find(() => true);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-find.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].values().find(() => true);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-find.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].values().find(() => true);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-find");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].values().find(() => true);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-flat-map.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0]
      .values()
      .flatMap(() => [made])
      .next().value;
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
  console.log("# road-iterator-flat-map.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0]
      .values()
      .flatMap(() => [made])
      .next().value;
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
  console.log("# road-iterator-flat-map.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0]
      .values()
      .flatMap(() => [made])
      .next().value;
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
  console.log("# road-iterator-flat-map.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0]
      .values()
      .flatMap(() => [made])
      .next().value;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-flat-map.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0]
      .values()
      .flatMap(() => [made])
      .next().value;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-flat-map.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0]
      .values()
      .flatMap(() => [made])
      .next().value;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-flat-map.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0]
      .values()
      .flatMap(() => [made])
      .next().value;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-flat-map");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0]
      .values()
      .flatMap(() => [made])
      .next().value;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-from.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Iterator.from([made]).next().value;
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
  console.log("# road-iterator-from.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Iterator.from([made]).next().value;
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
  console.log("# road-iterator-from.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Iterator.from([made]).next().value;
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
  console.log("# road-iterator-from.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Iterator.from([made]).next().value;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-from.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Iterator.from([made]).next().value;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-from.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Iterator.from([made]).next().value;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-from.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Iterator.from([made]).next().value;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-from");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Iterator.from([made]).next().value;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-map.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made]
      .values()
      .map(x => x)
      .next().value;
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
  console.log("# road-iterator-map.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made]
      .values()
      .map(x => x)
      .next().value;
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
  console.log("# road-iterator-map.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made]
      .values()
      .map(x => x)
      .next().value;
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
  console.log("# road-iterator-map.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made]
      .values()
      .map(x => x)
      .next().value;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-map.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made]
      .values()
      .map(x => x)
      .next().value;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-map.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made]
      .values()
      .map(x => x)
      .next().value;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-map.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made]
      .values()
      .map(x => x)
      .next().value;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-map");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made]
      .values()
      .map(x => x)
      .next().value;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-reduce.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].values().reduce((a, x) => x, null);
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
  console.log("# road-iterator-reduce.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].values().reduce((a, x) => x, null);
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
  console.log("# road-iterator-reduce.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].values().reduce((a, x) => x, null);
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
  console.log("# road-iterator-reduce.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].values().reduce((a, x) => x, null);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-reduce.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].values().reduce((a, x) => x, null);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-reduce.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].values().reduce((a, x) => x, null);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-reduce.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].values().reduce((a, x) => x, null);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-reduce");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].values().reduce((a, x) => x, null);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-take.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].values().take(1).toArray()[0];
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
  console.log("# road-iterator-take.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].values().take(1).toArray()[0];
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
  console.log("# road-iterator-take.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].values().take(1).toArray()[0];
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
  console.log("# road-iterator-take.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].values().take(1).toArray()[0];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-take.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].values().take(1).toArray()[0];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-take.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].values().take(1).toArray()[0];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-take.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].values().take(1).toArray()[0];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-iterator-take");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].values().take(1).toArray()[0];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
