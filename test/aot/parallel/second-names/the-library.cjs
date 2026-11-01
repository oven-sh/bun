// An object gets a second name (the library), is read, is changed under the second name, and is read again under the first.
{
  console.log("# road-async-local-storage.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (s => s.run(made, () => s.getStore()))(new (require("node:async_hooks").AsyncLocalStorage)());
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
  console.log("# road-async-local-storage.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (s => s.run(made, () => s.getStore()))(new (require("node:async_hooks").AsyncLocalStorage)());
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
  console.log("# road-async-local-storage.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (s => s.run(made, () => s.getStore()))(new (require("node:async_hooks").AsyncLocalStorage)());
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
  console.log("# road-async-local-storage.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (s => s.run(made, () => s.getStore()))(new (require("node:async_hooks").AsyncLocalStorage)());
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-async-local-storage.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (s => s.run(made, () => s.getStore()))(new (require("node:async_hooks").AsyncLocalStorage)());
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-async-local-storage.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (s => s.run(made, () => s.getStore()))(new (require("node:async_hooks").AsyncLocalStorage)());
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-async-local-storage.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (s => s.run(made, () => s.getStore()))(new (require("node:async_hooks").AsyncLocalStorage)());
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-async-local-storage");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (s => s.run(made, () => s.getStore()))(new (require("node:async_hooks").AsyncLocalStorage)());
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-emitter.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      const e = new (require("node:events"))();
      e.on("x", v => {
        got = v;
      });
      e.emit("x", made);
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
  console.log("# road-emitter.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      const e = new (require("node:events"))();
      e.on("x", v => {
        got = v;
      });
      e.emit("x", made);
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
  console.log("# road-emitter.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      const e = new (require("node:events"))();
      e.on("x", v => {
        got = v;
      });
      e.emit("x", made);
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
  console.log("# road-emitter.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      const e = new (require("node:events"))();
      e.on("x", v => {
        got = v;
      });
      e.emit("x", made);
      return got;
    })();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-emitter.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      const e = new (require("node:events"))();
      e.on("x", v => {
        got = v;
      });
      e.emit("x", made);
      return got;
    })();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-emitter.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      const e = new (require("node:events"))();
      e.on("x", v => {
        got = v;
      });
      e.emit("x", made);
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
  console.log("# road-emitter.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      const e = new (require("node:events"))();
      e.on("x", v => {
        got = v;
      });
      e.emit("x", made);
      return got;
    })();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-emitter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      const e = new (require("node:events"))();
      e.on("x", v => {
        got = v;
      });
      e.emit("x", made);
      return got;
    })();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-module-exports.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((module.exports.held = made), exports.held);
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
  console.log("# road-module-exports.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((module.exports.held = made), exports.held);
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
  console.log("# road-module-exports.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((module.exports.held = made), exports.held);
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
  console.log("# road-module-exports.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((module.exports.held = made), exports.held);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-module-exports.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((module.exports.held = made), exports.held);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-module-exports.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((module.exports.held = made), exports.held);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-module-exports.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((module.exports.held = made), exports.held);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-module-exports");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((module.exports.held = made), exports.held);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-util-callbackify-none.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = require("node:util").types.isProxy(made) ? null : made;
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
  console.log("# road-util-callbackify-none.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = require("node:util").types.isProxy(made) ? null : made;
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
  console.log("# road-util-callbackify-none.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = require("node:util").types.isProxy(made) ? null : made;
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
  console.log("# road-util-callbackify-none.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = require("node:util").types.isProxy(made) ? null : made;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-util-callbackify-none.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = require("node:util").types.isProxy(made) ? null : made;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-util-callbackify-none.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = require("node:util").types.isProxy(made) ? null : made;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-util-callbackify-none.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = require("node:util").types.isProxy(made) ? null : made;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-util-callbackify-none");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = require("node:util").types.isProxy(made) ? null : made;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
