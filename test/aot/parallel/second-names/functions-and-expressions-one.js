// An object gets a second name (functions and expressions), is read, is changed under the second name, and is read again under the first.
{
  console.log("# road-aggregate-error.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new AggregateError([made]).errors[0];
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
  console.log("# road-aggregate-error.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new AggregateError([made]).errors[0];
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
  console.log("# road-aggregate-error.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new AggregateError([made]).errors[0];
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
  console.log("# road-aggregate-error.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new AggregateError([made]).errors[0];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-aggregate-error.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new AggregateError([made]).errors[0];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-aggregate-error.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new AggregateError([made]).errors[0];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-aggregate-error.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new AggregateError([made]).errors[0];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-aggregate-error");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new AggregateError([made]).errors[0];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-and.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = true && made;
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
  console.log("# road-and.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = true && made;
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
  console.log("# road-and.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = true && made;
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
  console.log("# road-and.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = true && made;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-and.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = true && made;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-and.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = true && made;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-and.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = true && made;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-and");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = true && made;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-arrow-this.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = function () {
      return (() => this)();
    }.call(made);
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
  console.log("# road-arrow-this.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = function () {
      return (() => this)();
    }.call(made);
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
  console.log("# road-arrow-this.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = function () {
      return (() => this)();
    }.call(made);
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
  console.log("# road-arrow-this.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = function () {
      return (() => this)();
    }.call(made);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-arrow-this.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = function () {
      return (() => this)();
    }.call(made);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-arrow-this.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = function () {
      return (() => this)();
    }.call(made);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-arrow-this.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = function () {
      return (() => this)();
    }.call(made);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-arrow-this");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = function () {
      return (() => this)();
    }.call(made);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-assignment-value.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x;
      return (x = made);
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
  console.log("# road-assignment-value.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x;
      return (x = made);
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
  console.log("# road-assignment-value.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x;
      return (x = made);
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
  console.log("# road-assignment-value.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x;
      return (x = made);
    })();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-assignment-value.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x;
      return (x = made);
    })();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-assignment-value.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x;
      return (x = made);
    })();
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-assignment-value.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x;
      return (x = made);
    })();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-assignment-value");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x;
      return (x = made);
    })();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-bound-argument.change-freeze");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same.bind(null, made)();
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
  console.log("# road-bound-argument.change-getter");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same.bind(null, made)();
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
  console.log("# road-bound-argument.change-in-a-closure");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same.bind(null, made)();
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
  console.log("# road-bound-argument.change-inner-push");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same.bind(null, made)();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-bound-argument.change-other-kind");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same.bind(null, made)();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-bound-argument.change-prototype");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same.bind(null, made)();
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-bound-argument.change-store");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same.bind(null, made)();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-bound-argument");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same.bind(null, made)();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-catch-pattern.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      try {
        throw { a: made };
      } catch ({ a }) {
        return a;
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
  console.log("# road-catch-pattern.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      try {
        throw { a: made };
      } catch ({ a }) {
        return a;
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
  console.log("# road-catch-pattern.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      try {
        throw { a: made };
      } catch ({ a }) {
        return a;
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
  console.log("# road-catch-pattern.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      try {
        throw { a: made };
      } catch ({ a }) {
        return a;
      }
    })();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-catch-pattern.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      try {
        throw { a: made };
      } catch ({ a }) {
        return a;
      }
    })();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-catch-pattern.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      try {
        throw { a: made };
      } catch ({ a }) {
        return a;
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
  console.log("# road-catch-pattern.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      try {
        throw { a: made };
      } catch ({ a }) {
        return a;
      }
    })();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-catch-pattern");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      try {
        throw { a: made };
      } catch ({ a }) {
        return a;
      }
    })();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-closure-of-closure.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      () => () =>
        made
    )()();
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
  console.log("# road-closure-of-closure.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      () => () =>
        made
    )()();
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
  console.log("# road-closure-of-closure.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      () => () =>
        made
    )()();
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
  console.log("# road-closure-of-closure.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      () => () =>
        made
    )()();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-closure-of-closure.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      () => () =>
        made
    )()();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-closure-of-closure.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      () => () =>
        made
    )()();
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-closure-of-closure.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      () => () =>
        made
    )()();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-closure-of-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      () => () =>
        made
    )()();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-comma.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (0, made);
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
  console.log("# road-comma.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (0, made);
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
  console.log("# road-comma.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (0, made);
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
  console.log("# road-comma.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (0, made);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-comma.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (0, made);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-comma.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (0, made);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-comma.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (0, made);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-comma");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (0, made);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-computed-member.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { held: made }[["he", "ld"].join("")];
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
  console.log("# road-computed-member.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { held: made }[["he", "ld"].join("")];
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
  console.log("# road-computed-member.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { held: made }[["he", "ld"].join("")];
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
  console.log("# road-computed-member.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { held: made }[["he", "ld"].join("")];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-computed-member.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { held: made }[["he", "ld"].join("")];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-computed-member.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { held: made }[["he", "ld"].join("")];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-computed-member.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { held: made }[["he", "ld"].join("")];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-computed-member");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { held: made }[["he", "ld"].join("")];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-computed-pattern.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ ["a"]: x }) => x)({ a: made });
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
  console.log("# road-computed-pattern.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ ["a"]: x }) => x)({ a: made });
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
  console.log("# road-computed-pattern.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ ["a"]: x }) => x)({ a: made });
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
  console.log("# road-computed-pattern.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ ["a"]: x }) => x)({ a: made });
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-computed-pattern.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ ["a"]: x }) => x)({ a: made });
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-computed-pattern.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ ["a"]: x }) => x)({ a: made });
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-computed-pattern.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ ["a"]: x }) => x)({ a: made });
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-computed-pattern");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ ["a"]: x }) => x)({ a: made });
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-default-parameter.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((x = made) => x)();
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
  console.log("# road-default-parameter.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((x = made) => x)();
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
  console.log("# road-default-parameter.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((x = made) => x)();
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
  console.log("# road-default-parameter.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((x = made) => x)();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-default-parameter.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((x = made) => x)();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-default-parameter.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((x = made) => x)();
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-default-parameter.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((x = made) => x)();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-default-parameter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((x = made) => x)();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-error-cause.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Error("x", { cause: made }).cause;
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
  console.log("# road-error-cause.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Error("x", { cause: made }).cause;
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
  console.log("# road-error-cause.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Error("x", { cause: made }).cause;
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
  console.log("# road-error-cause.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Error("x", { cause: made }).cause;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-error-cause.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Error("x", { cause: made }).cause;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-error-cause.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Error("x", { cause: made }).cause;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-error-cause.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Error("x", { cause: made }).cause;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-error-cause");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Error("x", { cause: made }).cause;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-error-field.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      try {
        throw Object.assign(new Error("x"), { held: made });
      } catch (e) {
        return e.held;
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
  console.log("# road-error-field.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      try {
        throw Object.assign(new Error("x"), { held: made });
      } catch (e) {
        return e.held;
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
  console.log("# road-error-field.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      try {
        throw Object.assign(new Error("x"), { held: made });
      } catch (e) {
        return e.held;
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
  console.log("# road-error-field.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      try {
        throw Object.assign(new Error("x"), { held: made });
      } catch (e) {
        return e.held;
      }
    })();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-error-field.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      try {
        throw Object.assign(new Error("x"), { held: made });
      } catch (e) {
        return e.held;
      }
    })();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-error-field.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      try {
        throw Object.assign(new Error("x"), { held: made });
      } catch (e) {
        return e.held;
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
  console.log("# road-error-field.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      try {
        throw Object.assign(new Error("x"), { held: made });
      } catch (e) {
        return e.held;
      }
    })();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-error-field");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      try {
        throw Object.assign(new Error("x"), { held: made });
      } catch (e) {
        return e.held;
      }
    })();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-finally-return.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      try {
        return null;
      } finally {
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
  console.log("# road-finally-return.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      try {
        return null;
      } finally {
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
  console.log("# road-finally-return.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      try {
        return null;
      } finally {
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
  console.log("# road-finally-return.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      try {
        return null;
      } finally {
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
  console.log("# road-finally-return.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      try {
        return null;
      } finally {
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
  console.log("# road-finally-return.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      try {
        return null;
      } finally {
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
  console.log("# road-finally-return.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      try {
        return null;
      } finally {
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
  console.log("# road-finally-return");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      try {
        return null;
      } finally {
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
  console.log("# road-has-instance.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      made instanceof
        {
          [Symbol.hasInstance](x) {
            got = x;
            return true;
          },
        };
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
  console.log("# road-has-instance.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      made instanceof
        {
          [Symbol.hasInstance](x) {
            got = x;
            return true;
          },
        };
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
  console.log("# road-has-instance.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      made instanceof
        {
          [Symbol.hasInstance](x) {
            got = x;
            return true;
          },
        };
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
  console.log("# road-has-instance.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      made instanceof
        {
          [Symbol.hasInstance](x) {
            got = x;
            return true;
          },
        };
      return got;
    })();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-has-instance.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      made instanceof
        {
          [Symbol.hasInstance](x) {
            got = x;
            return true;
          },
        };
      return got;
    })();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-has-instance.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      made instanceof
        {
          [Symbol.hasInstance](x) {
            got = x;
            return true;
          },
        };
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
  console.log("# road-has-instance.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      made instanceof
        {
          [Symbol.hasInstance](x) {
            got = x;
            return true;
          },
        };
      return got;
    })();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-has-instance");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      made instanceof
        {
          [Symbol.hasInstance](x) {
            got = x;
            return true;
          },
        };
      return got;
    })();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-indirect-eval.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (0, eval)("(x) => x")(made);
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
  console.log("# road-indirect-eval.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (0, eval)("(x) => x")(made);
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
  console.log("# road-indirect-eval.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (0, eval)("(x) => x")(made);
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
  console.log("# road-indirect-eval.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (0, eval)("(x) => x")(made);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-indirect-eval.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (0, eval)("(x) => x")(made);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-indirect-eval.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (0, eval)("(x) => x")(made);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-indirect-eval.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (0, eval)("(x) => x")(made);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-indirect-eval");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (0, eval)("(x) => x")(made);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-list-pattern-default.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([x = made]) => x)([]);
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
  console.log("# road-list-pattern-default.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([x = made]) => x)([]);
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
