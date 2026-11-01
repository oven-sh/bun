// An object gets a second name (lists), is read, is changed under the second name, and is read again under the first.
{
  console.log("# road-index-of.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => l[l.indexOf(made)])([0, made]);
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
  console.log("# road-index-of.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => l[l.indexOf(made)])([0, made]);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-index-of.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => l[l.indexOf(made)])([0, made]);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-index-of.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => l[l.indexOf(made)])([0, made]);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-index-of.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => l[l.indexOf(made)])([0, made]);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-index-of");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => l[l.indexOf(made)])([0, made]);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-list-entries.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].entries().next().value[1];
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
  console.log("# road-list-entries.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].entries().next().value[1];
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
  console.log("# road-list-entries.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].entries().next().value[1];
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
  console.log("# road-list-entries.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].entries().next().value[1];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-list-entries.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].entries().next().value[1];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-list-entries.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].entries().next().value[1];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-list-entries.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].entries().next().value[1];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-list-entries");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].entries().next().value[1];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-list-in-list.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [[made]][0][0];
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
  console.log("# road-list-in-list.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [[made]][0][0];
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
  console.log("# road-list-in-list.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [[made]][0][0];
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
  console.log("# road-list-in-list.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [[made]][0][0];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-list-in-list.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [[made]][0][0];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-list-in-list.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [[made]][0][0];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-list-in-list.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [[made]][0][0];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-list-in-list");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [[made]][0][0];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-list-pattern-rest.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([...r]) => r[0])([made]);
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
  console.log("# road-list-pattern-rest.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([...r]) => r[0])([made]);
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
  console.log("# road-list-pattern-rest.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([...r]) => r[0])([made]);
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
  console.log("# road-list-pattern-rest.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([...r]) => r[0])([made]);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-list-pattern-rest.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([...r]) => r[0])([made]);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-list-pattern-rest.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([...r]) => r[0])([made]);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-list-pattern-rest.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([...r]) => r[0])([made]);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-list-pattern-rest");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([...r]) => r[0])([made]);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-list-pattern-skip.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([, x]) => x)([0, made]);
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
  console.log("# road-list-pattern-skip.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([, x]) => x)([0, made]);
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
  console.log("# road-list-pattern-skip.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([, x]) => x)([0, made]);
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
  console.log("# road-list-pattern-skip.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([, x]) => x)([0, made]);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-list-pattern-skip.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([, x]) => x)([0, made]);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-list-pattern-skip.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([, x]) => x)([0, made]);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-list-pattern-skip.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([, x]) => x)([0, made]);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-list-pattern-skip");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([, x]) => x)([0, made]);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-this.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0].map(function () {
      return this;
    }, made)[0];
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
  console.log("# road-map-this.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0].map(function () {
      return this;
    }, made)[0];
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
  console.log("# road-map-this.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0].map(function () {
      return this;
    }, made)[0];
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
  console.log("# road-map-this.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0].map(function () {
      return this;
    }, made)[0];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-this.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0].map(function () {
      return this;
    }, made)[0];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-this.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0].map(function () {
      return this;
    }, made)[0];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-this.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0].map(function () {
      return this;
    }, made)[0];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-this");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [0].map(function () {
      return this;
    }, made)[0];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-pushed.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => (l.push(made), l[0]))([]);
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
  console.log("# road-pushed.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => (l.push(made), l[0]))([]);
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
  console.log("# road-pushed.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => (l.push(made), l[0]))([]);
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
  console.log("# road-pushed.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => (l.push(made), l[0]))([]);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-pushed.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => (l.push(made), l[0]))([]);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-pushed.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => (l.push(made), l[0]))([]);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-pushed.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => (l.push(made), l[0]))([]);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-pushed");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (l => (l.push(made), l[0]))([]);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-reduce-no-start.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].reduce(a => a);
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
  console.log("# road-reduce-no-start.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].reduce(a => a);
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
  console.log("# road-reduce-no-start.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].reduce(a => a);
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
  console.log("# road-reduce-no-start.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].reduce(a => a);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-reduce-no-start.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].reduce(a => a);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-reduce-no-start.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].reduce(a => a);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-reduce-no-start.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].reduce(a => a);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-reduce-no-start");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].reduce(a => a);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-reduce-right.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].reduceRight((a, x) => x, null);
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
  console.log("# road-reduce-right.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].reduceRight((a, x) => x, null);
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
  console.log("# road-reduce-right.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].reduceRight((a, x) => x, null);
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
  console.log("# road-reduce-right.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].reduceRight((a, x) => x, null);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-reduce-right.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].reduceRight((a, x) => x, null);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-reduce-right.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].reduceRight((a, x) => x, null);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-reduce-right.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].reduceRight((a, x) => x, null);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-reduce-right");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].reduceRight((a, x) => x, null);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-rest-parameter.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((...r) => r[0])(made);
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
  console.log("# road-rest-parameter.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((...r) => r[0])(made);
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
  console.log("# road-rest-parameter.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((...r) => r[0])(made);
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
  console.log("# road-rest-parameter.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((...r) => r[0])(made);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-rest-parameter.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((...r) => r[0])(made);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-rest-parameter.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((...r) => r[0])(made);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-rest-parameter.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((...r) => r[0])(made);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-rest-parameter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((...r) => r[0])(made);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-shift.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].shift();
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
  console.log("# road-shift.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].shift();
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
  console.log("# road-shift.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].shift();
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
  console.log("# road-shift.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].shift();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-shift.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].shift();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-shift.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].shift();
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-shift.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].shift();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-shift");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].shift();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-sliced-arguments.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function () {
      return Array.prototype.slice.call(arguments)[0];
    })(made);
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
  console.log("# road-sliced-arguments.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function () {
      return Array.prototype.slice.call(arguments)[0];
    })(made);
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
  console.log("# road-sliced-arguments.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function () {
      return Array.prototype.slice.call(arguments)[0];
    })(made);
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
  console.log("# road-sliced-arguments.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function () {
      return Array.prototype.slice.call(arguments)[0];
    })(made);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-sliced-arguments.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function () {
      return Array.prototype.slice.call(arguments)[0];
    })(made);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-sliced-arguments.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function () {
      return Array.prototype.slice.call(arguments)[0];
    })(made);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-sliced-arguments.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function () {
      return Array.prototype.slice.call(arguments)[0];
    })(made);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-sliced-arguments");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function () {
      return Array.prototype.slice.call(arguments)[0];
    })(made);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-some.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      [made].some(x => (got = x));
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
  console.log("# road-some.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      [made].some(x => (got = x));
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
  console.log("# road-some.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      [made].some(x => (got = x));
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
  console.log("# road-some.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      [made].some(x => (got = x));
      return got;
    })();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-some.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      [made].some(x => (got = x));
      return got;
    })();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-some.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      [made].some(x => (got = x));
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
  console.log("# road-some.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      [made].some(x => (got = x));
      return got;
    })();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-some");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      [made].some(x => (got = x));
      return got;
    })();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-splice.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].splice(0, 1)[0];
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
  console.log("# road-splice.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].splice(0, 1)[0];
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
  console.log("# road-splice.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].splice(0, 1)[0];
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
  console.log("# road-splice.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].splice(0, 1)[0];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-splice.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].splice(0, 1)[0];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-splice.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].splice(0, 1)[0];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-splice.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].splice(0, 1)[0];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-splice");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [made].splice(0, 1)[0];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-spread-arguments.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function () {
      return [...arguments][0];
    })(made);
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
  console.log("# road-spread-arguments.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function () {
      return [...arguments][0];
    })(made);
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
  console.log("# road-spread-arguments.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function () {
      return [...arguments][0];
    })(made);
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
  console.log("# road-spread-arguments.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function () {
      return [...arguments][0];
    })(made);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-spread-arguments.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function () {
      return [...arguments][0];
    })(made);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-spread-arguments.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function () {
      return [...arguments][0];
    })(made);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-spread-arguments.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function () {
      return [...arguments][0];
    })(made);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-spread-arguments");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function () {
      return [...arguments][0];
    })(made);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-spread-call-set.change-freeze");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same(...new Set([made]));
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
  console.log("# road-spread-call-set.change-getter");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same(...new Set([made]));
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
  console.log("# road-spread-call-set.change-in-a-closure");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same(...new Set([made]));
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
  console.log("# road-spread-call-set.change-inner-push");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same(...new Set([made]));
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-spread-call-set.change-other-kind");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same(...new Set([made]));
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-spread-call-set.change-prototype");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same(...new Set([made]));
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-spread-call-set.change-store");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same(...new Set([made]));
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-spread-call-set");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same(...new Set([made]));
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-spread-call.change-freeze");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same(...[made]);
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
  console.log("# road-spread-call.change-getter");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same(...[made]);
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
  console.log("# road-spread-call.change-in-a-closure");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same(...[made]);
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
  console.log("# road-spread-call.change-inner-push");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same(...[made]);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
