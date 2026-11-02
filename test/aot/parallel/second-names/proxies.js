// An object gets a second name (proxies), is read, is changed under the second name, and is read again under the first.
{
  console.log("# road-proxy-answers.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(
      {},
      {
        get() {
          return made;
        },
      },
    ).anything;
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
  console.log("# road-proxy-answers.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(
      {},
      {
        get() {
          return made;
        },
      },
    ).anything;
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
  console.log("# road-proxy-answers.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(
      {},
      {
        get() {
          return made;
        },
      },
    ).anything;
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
  console.log("# road-proxy-answers.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(
      {},
      {
        get() {
          return made;
        },
      },
    ).anything;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proxy-answers.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(
      {},
      {
        get() {
          return made;
        },
      },
    ).anything;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proxy-answers.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(
      {},
      {
        get() {
          return made;
        },
      },
    ).anything;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proxy-answers.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(
      {},
      {
        get() {
          return made;
        },
      },
    ).anything;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proxy-answers");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(
      {},
      {
        get() {
          return made;
        },
      },
    ).anything;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proxy-of-proxy.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(new Proxy(made, {}), {});
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
  console.log("# road-proxy-of-proxy.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(new Proxy(made, {}), {});
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
  console.log("# road-proxy-of-proxy.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(new Proxy(made, {}), {});
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
  console.log("# road-proxy-of-proxy.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(new Proxy(made, {}), {});
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proxy-of-proxy.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(new Proxy(made, {}), {});
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proxy-of-proxy.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(new Proxy(made, {}), {});
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proxy-of-proxy.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(new Proxy(made, {}), {});
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proxy-of-proxy");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(new Proxy(made, {}), {});
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proxy-plain.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(made, {});
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
  console.log("# road-proxy-plain.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(made, {});
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
  console.log("# road-proxy-plain.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(made, {});
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
  console.log("# road-proxy-plain.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(made, {});
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proxy-plain.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(made, {});
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proxy-plain.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(made, {});
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proxy-plain.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(made, {});
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proxy-plain");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(made, {});
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proxy-reflect.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(made, {
      set: Reflect.set,
      deleteProperty: Reflect.deleteProperty,
      defineProperty: Reflect.defineProperty,
    });
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
  console.log("# road-proxy-reflect.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(made, {
      set: Reflect.set,
      deleteProperty: Reflect.deleteProperty,
      defineProperty: Reflect.defineProperty,
    });
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
  console.log("# road-proxy-reflect.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(made, {
      set: Reflect.set,
      deleteProperty: Reflect.deleteProperty,
      defineProperty: Reflect.defineProperty,
    });
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
  console.log("# road-proxy-reflect.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(made, {
      set: Reflect.set,
      deleteProperty: Reflect.deleteProperty,
      defineProperty: Reflect.defineProperty,
    });
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proxy-reflect.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(made, {
      set: Reflect.set,
      deleteProperty: Reflect.deleteProperty,
      defineProperty: Reflect.defineProperty,
    });
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proxy-reflect.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(made, {
      set: Reflect.set,
      deleteProperty: Reflect.deleteProperty,
      defineProperty: Reflect.defineProperty,
    });
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proxy-reflect.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(made, {
      set: Reflect.set,
      deleteProperty: Reflect.deleteProperty,
      defineProperty: Reflect.defineProperty,
    });
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proxy-reflect");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Proxy(made, {
      set: Reflect.set,
      deleteProperty: Reflect.deleteProperty,
      defineProperty: Reflect.defineProperty,
    });
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proxy-revocable.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Proxy.revocable(made, {}).proxy;
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
  console.log("# road-proxy-revocable.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Proxy.revocable(made, {}).proxy;
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
  console.log("# road-proxy-revocable.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Proxy.revocable(made, {}).proxy;
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
  console.log("# road-proxy-revocable.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Proxy.revocable(made, {}).proxy;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proxy-revocable.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Proxy.revocable(made, {}).proxy;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proxy-revocable.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Proxy.revocable(made, {}).proxy;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proxy-revocable.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Proxy.revocable(made, {}).proxy;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-proxy-revocable");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Proxy.revocable(made, {}).proxy;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-trap-receiver-target.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      "x" in
        new Proxy(made, {
          has(t) {
            got = t;
            return true;
          },
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
  console.log("# road-trap-receiver-target.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      "x" in
        new Proxy(made, {
          has(t) {
            got = t;
            return true;
          },
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
  console.log("# road-trap-receiver-target.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      "x" in
        new Proxy(made, {
          has(t) {
            got = t;
            return true;
          },
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
  console.log("# road-trap-receiver-target.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      "x" in
        new Proxy(made, {
          has(t) {
            got = t;
            return true;
          },
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
  console.log("# road-trap-receiver-target.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      "x" in
        new Proxy(made, {
          has(t) {
            got = t;
            return true;
          },
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
  console.log("# road-trap-receiver-target.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      "x" in
        new Proxy(made, {
          has(t) {
            got = t;
            return true;
          },
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
  console.log("# road-trap-receiver-target.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      "x" in
        new Proxy(made, {
          has(t) {
            got = t;
            return true;
          },
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
  console.log("# road-trap-receiver-target");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      "x" in
        new Proxy(made, {
          has(t) {
            got = t;
            return true;
          },
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
  console.log("# road-trap-target.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      new Proxy(made, {
        get(t) {
          got = t;
        },
      }).x;
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
  console.log("# road-trap-target.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      new Proxy(made, {
        get(t) {
          got = t;
        },
      }).x;
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
  console.log("# road-trap-target.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      new Proxy(made, {
        get(t) {
          got = t;
        },
      }).x;
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
  console.log("# road-trap-target.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      new Proxy(made, {
        get(t) {
          got = t;
        },
      }).x;
      return got;
    })();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-trap-target.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      new Proxy(made, {
        get(t) {
          got = t;
        },
      }).x;
      return got;
    })();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-trap-target.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      new Proxy(made, {
        get(t) {
          got = t;
        },
      }).x;
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
  console.log("# road-trap-target.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      new Proxy(made, {
        get(t) {
          got = t;
        },
      }).x;
      return got;
    })();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-trap-target");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      new Proxy(made, {
        get(t) {
          got = t;
        },
      }).x;
      return got;
    })();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
