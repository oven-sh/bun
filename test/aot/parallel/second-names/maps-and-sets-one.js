// An object gets a second name (maps and sets), is read, is changed under the second name, and is read again under the first.
{
  console.log("# road-map-entries.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Map([[1, made]]).entries().next().value[1];
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
  console.log("# road-map-entries.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Map([[1, made]]).entries().next().value[1];
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
  console.log("# road-map-entries.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Map([[1, made]]).entries().next().value[1];
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
  console.log("# road-map-entries.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Map([[1, made]]).entries().next().value[1];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-entries.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Map([[1, made]]).entries().next().value[1];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-entries.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Map([[1, made]]).entries().next().value[1];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-entries.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Map([[1, made]]).entries().next().value[1];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-entries");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Map([[1, made]]).entries().next().value[1];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-for-each-key.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      new Map([[made, 1]]).forEach((v, k) => {
        got = k;
      });
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
  console.log("# road-map-for-each-key.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      new Map([[made, 1]]).forEach((v, k) => {
        got = k;
      });
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
  console.log("# road-map-for-each-key.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      new Map([[made, 1]]).forEach((v, k) => {
        got = k;
      });
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
  console.log("# road-map-for-each-key.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      new Map([[made, 1]]).forEach((v, k) => {
        got = k;
      });
      return got;
    })();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-for-each-key.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      new Map([[made, 1]]).forEach((v, k) => {
        got = k;
      });
      return got;
    })();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-for-each-key.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      new Map([[made, 1]]).forEach((v, k) => {
        got = k;
      });
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
  console.log("# road-map-for-each-key.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      new Map([[made, 1]]).forEach((v, k) => {
        got = k;
      });
      return got;
    })();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-for-each-key");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      new Map([[made, 1]]).forEach((v, k) => {
        got = k;
      });
      return got;
    })();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-for-each.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      new Map([[1, made]]).forEach(v => {
        got = v;
      });
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
  console.log("# road-map-for-each.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      new Map([[1, made]]).forEach(v => {
        got = v;
      });
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
  console.log("# road-map-for-each.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      new Map([[1, made]]).forEach(v => {
        got = v;
      });
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
  console.log("# road-map-for-each.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      new Map([[1, made]]).forEach(v => {
        got = v;
      });
      return got;
    })();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-for-each.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      new Map([[1, made]]).forEach(v => {
        got = v;
      });
      return got;
    })();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-for-each.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      new Map([[1, made]]).forEach(v => {
        got = v;
      });
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
  console.log("# road-map-for-each.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      new Map([[1, made]]).forEach(v => {
        got = v;
      });
      return got;
    })();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-for-each");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      new Map([[1, made]]).forEach(v => {
        got = v;
      });
      return got;
    })();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-for-of.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      for (const [, v] of new Map([[1, made]])) return v;
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
  console.log("# road-map-for-of.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      for (const [, v] of new Map([[1, made]])) return v;
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
  console.log("# road-map-for-of.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      for (const [, v] of new Map([[1, made]])) return v;
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
  console.log("# road-map-for-of.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      for (const [, v] of new Map([[1, made]])) return v;
    })();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-for-of.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      for (const [, v] of new Map([[1, made]])) return v;
    })();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-for-of.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      for (const [, v] of new Map([[1, made]])) return v;
    })();
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-for-of.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      for (const [, v] of new Map([[1, made]])) return v;
    })();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-for-of");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      for (const [, v] of new Map([[1, made]])) return v;
    })();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-object-key.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (k => new Map([[k, made]]).get(k))({});
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
  console.log("# road-map-object-key.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (k => new Map([[k, made]]).get(k))({});
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
  console.log("# road-map-object-key.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (k => new Map([[k, made]]).get(k))({});
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
  console.log("# road-map-object-key.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (k => new Map([[k, made]]).get(k))({});
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-object-key.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (k => new Map([[k, made]]).get(k))({});
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-object-key.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (k => new Map([[k, made]]).get(k))({});
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-object-key.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (k => new Map([[k, made]]).get(k))({});
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-object-key");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (k => new Map([[k, made]]).get(k))({});
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-of-map.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Map(new Map([[1, made]])).get(1);
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
  console.log("# road-map-of-map.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Map(new Map([[1, made]])).get(1);
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
  console.log("# road-map-of-map.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Map(new Map([[1, made]])).get(1);
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
  console.log("# road-map-of-map.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Map(new Map([[1, made]])).get(1);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-of-map.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Map(new Map([[1, made]])).get(1);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-of-map.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Map(new Map([[1, made]])).get(1);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-of-map.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Map(new Map([[1, made]])).get(1);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-of-map");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Map(new Map([[1, made]])).get(1);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-set-get.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Map().set(1, made).get(1);
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
  console.log("# road-map-set-get.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Map().set(1, made).get(1);
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
  console.log("# road-map-set-get.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Map().set(1, made).get(1);
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
  console.log("# road-map-set-get.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Map().set(1, made).get(1);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-set-get.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Map().set(1, made).get(1);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-set-get.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Map().set(1, made).get(1);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-set-get.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Map().set(1, made).get(1);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-map-set-get");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Map().set(1, made).get(1);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-add.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set().add(made)][0];
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
  console.log("# road-set-add.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set().add(made)][0];
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
  console.log("# road-set-add.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set().add(made)][0];
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
  console.log("# road-set-add.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set().add(made)][0];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-add.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set().add(made)][0];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-add.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set().add(made)][0];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-add.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set().add(made)][0];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-add");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set().add(made)][0];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-difference.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set([made]).difference(new Set())][0];
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
  console.log("# road-set-difference.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set([made]).difference(new Set())][0];
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
  console.log("# road-set-difference.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set([made]).difference(new Set())][0];
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
  console.log("# road-set-difference.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set([made]).difference(new Set())][0];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-difference.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set([made]).difference(new Set())][0];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-difference.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set([made]).difference(new Set())][0];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-difference.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set([made]).difference(new Set())][0];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-difference");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set([made]).difference(new Set())][0];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-entries.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Set([made]).entries().next().value[0];
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
  console.log("# road-set-entries.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Set([made]).entries().next().value[0];
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
  console.log("# road-set-entries.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Set([made]).entries().next().value[0];
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
  console.log("# road-set-entries.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Set([made]).entries().next().value[0];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-entries.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Set([made]).entries().next().value[0];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-entries.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Set([made]).entries().next().value[0];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-entries.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Set([made]).entries().next().value[0];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-entries");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Set([made]).entries().next().value[0];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-from-mapped.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Array.from(new Set([made]), x => x)[0];
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
  console.log("# road-set-from-mapped.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Array.from(new Set([made]), x => x)[0];
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
  console.log("# road-set-from-mapped.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Array.from(new Set([made]), x => x)[0];
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
  console.log("# road-set-from-mapped.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Array.from(new Set([made]), x => x)[0];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-from-mapped.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Array.from(new Set([made]), x => x)[0];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-from-mapped.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Array.from(new Set([made]), x => x)[0];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-from-mapped.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Array.from(new Set([made]), x => x)[0];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-from-mapped");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Array.from(new Set([made]), x => x)[0];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-intersection.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set([made]).intersection(new Set([made]))][0];
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
  console.log("# road-set-intersection.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set([made]).intersection(new Set([made]))][0];
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
  console.log("# road-set-intersection.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set([made]).intersection(new Set([made]))][0];
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
  console.log("# road-set-intersection.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set([made]).intersection(new Set([made]))][0];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-intersection.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set([made]).intersection(new Set([made]))][0];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-intersection.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set([made]).intersection(new Set([made]))][0];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-intersection.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set([made]).intersection(new Set([made]))][0];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-intersection");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set([made]).intersection(new Set([made]))][0];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-keys.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Set([made]).keys().next().value;
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
  console.log("# road-set-keys.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Set([made]).keys().next().value;
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
  console.log("# road-set-keys.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Set([made]).keys().next().value;
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
  console.log("# road-set-keys.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Set([made]).keys().next().value;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-keys.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Set([made]).keys().next().value;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-keys.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Set([made]).keys().next().value;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-keys.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Set([made]).keys().next().value;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-keys");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Set([made]).keys().next().value;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-of-set.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set(new Set([made]))][0];
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
  console.log("# road-set-of-set.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set(new Set([made]))][0];
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
  console.log("# road-set-of-set.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set(new Set([made]))][0];
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
  console.log("# road-set-of-set.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set(new Set([made]))][0];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-of-set.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set(new Set([made]))][0];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-of-set.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set(new Set([made]))][0];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-of-set.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set(new Set([made]))][0];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-of-set");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set(new Set([made]))][0];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-pattern.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([x]) => x)(new Set([made]));
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
  console.log("# road-set-pattern.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([x]) => x)(new Set([made]));
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
  console.log("# road-set-pattern.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([x]) => x)(new Set([made]));
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
  console.log("# road-set-pattern.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([x]) => x)(new Set([made]));
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-pattern.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([x]) => x)(new Set([made]));
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-pattern.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([x]) => x)(new Set([made]));
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-pattern.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([x]) => x)(new Set([made]));
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-pattern");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([x]) => x)(new Set([made]));
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-spread-call.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Array.of(...new Set([made]))[0];
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
  console.log("# road-set-spread-call.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Array.of(...new Set([made]))[0];
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
  console.log("# road-set-spread-call.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Array.of(...new Set([made]))[0];
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
  console.log("# road-set-spread-call.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Array.of(...new Set([made]))[0];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-spread-call.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Array.of(...new Set([made]))[0];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-spread-call.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Array.of(...new Set([made]))[0];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-spread-call.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Array.of(...new Set([made]))[0];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-spread-call");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Array.of(...new Set([made]))[0];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-set-union.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set([made]).union(new Set())][0];
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
  console.log("# road-set-union.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [...new Set([made]).union(new Set())][0];
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
