// An object gets a second name (after a wait), is read, is changed under the second name, and is read again under the first.
{
  console.log("# road-async-generator.change-freeze");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      await (async function* () {
        yield made;
      })().next()
    ).value;
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-async-generator.change-getter");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      await (async function* () {
        yield made;
      })().next()
    ).value;
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
  for (const each of [run]) await each();
}
{
  console.log("# road-async-generator.change-in-a-closure");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      await (async function* () {
        yield made;
      })().next()
    ).value;
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-async-generator.change-inner-push");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      await (async function* () {
        yield made;
      })().next()
    ).value;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-async-generator.change-other-kind");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      await (async function* () {
        yield made;
      })().next()
    ).value;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-async-generator.change-prototype");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      await (async function* () {
        yield made;
      })().next()
    ).value;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-async-generator.change-store");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      await (async function* () {
        yield made;
      })().next()
    ).value;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-async-generator");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      await (async function* () {
        yield made;
      })().next()
    ).value;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-all-settled.change-freeze");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (await Promise.allSettled([made]))[0].value;
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-all-settled.change-getter");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (await Promise.allSettled([made]))[0].value;
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
  for (const each of [run]) await each();
}
{
  console.log("# road-await-all-settled.change-in-a-closure");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (await Promise.allSettled([made]))[0].value;
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-all-settled.change-inner-push");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (await Promise.allSettled([made]))[0].value;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-all-settled.change-other-kind");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (await Promise.allSettled([made]))[0].value;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-all-settled.change-prototype");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (await Promise.allSettled([made]))[0].value;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-all-settled.change-store");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (await Promise.allSettled([made]))[0].value;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-all-settled");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (await Promise.allSettled([made]))[0].value;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-all.change-freeze");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (await Promise.all([made]))[0];
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-all.change-getter");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (await Promise.all([made]))[0];
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
  for (const each of [run]) await each();
}
{
  console.log("# road-await-all.change-in-a-closure");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (await Promise.all([made]))[0];
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-all.change-inner-push");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (await Promise.all([made]))[0];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-all.change-other-kind");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (await Promise.all([made]))[0];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-all.change-prototype");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (await Promise.all([made]))[0];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-all.change-store");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (await Promise.all([made]))[0];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-all");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (await Promise.all([made]))[0];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-any.change-freeze");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.any([made]);
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-any.change-getter");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.any([made]);
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
  for (const each of [run]) await each();
}
{
  console.log("# road-await-any.change-in-a-closure");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.any([made]);
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-any.change-inner-push");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.any([made]);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-any.change-other-kind");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.any([made]);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-any.change-prototype");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.any([made]);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-any.change-store");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.any([made]);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-any");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.any([made]);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-async-function.change-freeze");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => made)();
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-async-function.change-getter");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => made)();
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
  for (const each of [run]) await each();
}
{
  console.log("# road-await-async-function.change-in-a-closure");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => made)();
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-async-function.change-inner-push");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => made)();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-async-function.change-other-kind");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => made)();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-async-function.change-prototype");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => made)();
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-async-function.change-store");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => made)();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-async-function");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => made)();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-caught.change-freeze");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => {
      try {
        await Promise.reject(made);
      } catch (e) {
        return e;
      }
    })();
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-caught.change-getter");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => {
      try {
        await Promise.reject(made);
      } catch (e) {
        return e;
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
  for (const each of [run]) await each();
}
{
  console.log("# road-await-caught.change-in-a-closure");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => {
      try {
        await Promise.reject(made);
      } catch (e) {
        return e;
      }
    })();
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-caught.change-inner-push");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => {
      try {
        await Promise.reject(made);
      } catch (e) {
        return e;
      }
    })();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-caught.change-other-kind");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => {
      try {
        await Promise.reject(made);
      } catch (e) {
        return e;
      }
    })();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-caught.change-prototype");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => {
      try {
        await Promise.reject(made);
      } catch (e) {
        return e;
      }
    })();
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-caught.change-store");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => {
      try {
        await Promise.reject(made);
      } catch (e) {
        return e;
      }
    })();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-caught");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => {
      try {
        await Promise.reject(made);
      } catch (e) {
        return e;
      }
    })();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-finally.change-freeze");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.resolve(made).finally(() => 0);
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-finally.change-getter");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.resolve(made).finally(() => 0);
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
  for (const each of [run]) await each();
}
{
  console.log("# road-await-finally.change-in-a-closure");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.resolve(made).finally(() => 0);
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-finally.change-inner-push");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.resolve(made).finally(() => 0);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-finally.change-other-kind");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.resolve(made).finally(() => 0);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-finally.change-prototype");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.resolve(made).finally(() => 0);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-finally.change-store");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.resolve(made).finally(() => 0);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-finally");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.resolve(made).finally(() => 0);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-immediate.change-freeze");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => setImmediate(r, made));
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-immediate.change-getter");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => setImmediate(r, made));
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
  for (const each of [run]) await each();
}
{
  console.log("# road-await-immediate.change-in-a-closure");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => setImmediate(r, made));
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-immediate.change-inner-push");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => setImmediate(r, made));
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-immediate.change-other-kind");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => setImmediate(r, made));
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-immediate.change-prototype");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => setImmediate(r, made));
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-immediate.change-store");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => setImmediate(r, made));
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-immediate");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => setImmediate(r, made));
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-microtask.change-freeze");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => queueMicrotask(() => r(made)));
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-microtask.change-getter");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => queueMicrotask(() => r(made)));
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
  for (const each of [run]) await each();
}
{
  console.log("# road-await-microtask.change-in-a-closure");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => queueMicrotask(() => r(made)));
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-microtask.change-inner-push");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => queueMicrotask(() => r(made)));
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-microtask.change-other-kind");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => queueMicrotask(() => r(made)));
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-microtask.change-prototype");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => queueMicrotask(() => r(made)));
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-microtask.change-store");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => queueMicrotask(() => r(made)));
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-microtask");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => queueMicrotask(() => r(made)));
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-new-promise.change-freeze");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => r(made));
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-new-promise.change-getter");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => r(made));
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
  for (const each of [run]) await each();
}
{
  console.log("# road-await-new-promise.change-in-a-closure");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => r(made));
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-new-promise.change-inner-push");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => r(made));
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-new-promise.change-other-kind");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => r(made));
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-new-promise.change-prototype");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => r(made));
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-new-promise.change-store");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => r(made));
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-new-promise");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => r(made));
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-next-tick.change-freeze");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => process.nextTick(r, made));
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-next-tick.change-getter");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => process.nextTick(r, made));
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
  for (const each of [run]) await each();
}
{
  console.log("# road-await-next-tick.change-in-a-closure");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => process.nextTick(r, made));
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-next-tick.change-inner-push");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => process.nextTick(r, made));
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-next-tick.change-other-kind");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => process.nextTick(r, made));
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-next-tick.change-prototype");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => process.nextTick(r, made));
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-next-tick.change-store");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => process.nextTick(r, made));
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-next-tick");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => process.nextTick(r, made));
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-race.change-freeze");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.race([made]);
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-race.change-getter");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.race([made]);
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
  for (const each of [run]) await each();
}
{
  console.log("# road-await-race.change-in-a-closure");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.race([made]);
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-race.change-inner-push");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.race([made]);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-race.change-other-kind");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.race([made]);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-race.change-prototype");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.race([made]);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-race.change-store");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.race([made]);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-race");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.race([made]);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-rejection.change-freeze");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.reject(made).catch(e => e);
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-rejection.change-getter");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.reject(made).catch(e => e);
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
  for (const each of [run]) await each();
}
{
  console.log("# road-await-rejection.change-in-a-closure");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.reject(made).catch(e => e);
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-rejection.change-inner-push");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.reject(made).catch(e => e);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-rejection.change-other-kind");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.reject(made).catch(e => e);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-rejection.change-prototype");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.reject(made).catch(e => e);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-rejection.change-store");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.reject(made).catch(e => e);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-rejection");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.reject(made).catch(e => e);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-resolve.change-freeze");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.resolve(made);
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-resolve.change-getter");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.resolve(made);
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
  for (const each of [run]) await each();
}
{
  console.log("# road-await-resolve.change-in-a-closure");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.resolve(made);
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-resolve.change-inner-push");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.resolve(made);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-resolve.change-other-kind");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.resolve(made);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-resolve.change-prototype");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.resolve(made);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-resolve.change-store");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.resolve(made);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-resolve");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.resolve(made);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-then.change-freeze");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.resolve(0).then(() => made);
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-then.change-getter");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.resolve(0).then(() => made);
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
  for (const each of [run]) await each();
}
{
  console.log("# road-await-then.change-in-a-closure");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.resolve(0).then(() => made);
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-then.change-inner-push");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.resolve(0).then(() => made);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-then.change-other-kind");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.resolve(0).then(() => made);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-then.change-prototype");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.resolve(0).then(() => made);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-then.change-store");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.resolve(0).then(() => made);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-then");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await Promise.resolve(0).then(() => made);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-thenable.change-freeze");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await {
      then(r) {
        r(made);
      },
    };
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-thenable.change-getter");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await {
      then(r) {
        r(made);
      },
    };
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
  for (const each of [run]) await each();
}
{
  console.log("# road-await-thenable.change-in-a-closure");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await {
      then(r) {
        r(made);
      },
    };
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-thenable.change-inner-push");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await {
      then(r) {
        r(made);
      },
    };
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-thenable.change-other-kind");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await {
      then(r) {
        r(made);
      },
    };
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-thenable.change-prototype");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await {
      then(r) {
        r(made);
      },
    };
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-thenable.change-store");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await {
      then(r) {
        r(made);
      },
    };
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-thenable");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await {
      then(r) {
        r(made);
      },
    };
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-timer.change-freeze");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => setTimeout(r, 0, made));
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-timer.change-getter");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => setTimeout(r, 0, made));
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
  for (const each of [run]) await each();
}
