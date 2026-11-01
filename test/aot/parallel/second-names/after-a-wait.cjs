// An object gets a second name (after a wait), is read, is changed under the second name, and is read again under the first.
{
  console.log("# road-events-once.change-freeze");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      await (e => {
        const p = require("node:events").once(e, "x");
        e.emit("x", made);
        return p;
      })(new (require("node:events"))())
    )[0];
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  (async () => {
    for (const each of [run]) await each();
  })();
}
{
  console.log("# road-events-once.change-getter");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      await (e => {
        const p = require("node:events").once(e, "x");
        e.emit("x", made);
        return p;
      })(new (require("node:events"))())
    )[0];
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
  (async () => {
    for (const each of [run]) await each();
  })();
}
{
  console.log("# road-events-once.change-in-a-closure");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      await (e => {
        const p = require("node:events").once(e, "x");
        e.emit("x", made);
        return p;
      })(new (require("node:events"))())
    )[0];
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  (async () => {
    for (const each of [run]) await each();
  })();
}
{
  console.log("# road-events-once.change-inner-push");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      await (e => {
        const p = require("node:events").once(e, "x");
        e.emit("x", made);
        return p;
      })(new (require("node:events"))())
    )[0];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  (async () => {
    for (const each of [run]) await each();
  })();
}
{
  console.log("# road-events-once.change-other-kind");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      await (e => {
        const p = require("node:events").once(e, "x");
        e.emit("x", made);
        return p;
      })(new (require("node:events"))())
    )[0];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  (async () => {
    for (const each of [run]) await each();
  })();
}
{
  console.log("# road-events-once.change-prototype");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      await (e => {
        const p = require("node:events").once(e, "x");
        e.emit("x", made);
        return p;
      })(new (require("node:events"))())
    )[0];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  (async () => {
    for (const each of [run]) await each();
  })();
}
{
  console.log("# road-events-once.change-store");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      await (e => {
        const p = require("node:events").once(e, "x");
        e.emit("x", made);
        return p;
      })(new (require("node:events"))())
    )[0];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  (async () => {
    for (const each of [run]) await each();
  })();
}
{
  console.log("# road-events-once");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      await (e => {
        const p = require("node:events").once(e, "x");
        e.emit("x", made);
        return p;
      })(new (require("node:events"))())
    )[0];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  (async () => {
    for (const each of [run]) await each();
  })();
}
{
  console.log("# road-node-stream.change-freeze");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => {
      for await (const x of require("node:stream").Readable.from([made])) return x;
    })();
    const before = [made.label];
    Object.freeze(again);
    try {
      made.count = 3;
    } catch {}
    console.log(String(before[0]), String(made.label), again === made);
  }
  (async () => {
    for (const each of [run]) await each();
  })();
}
{
  console.log("# road-node-stream.change-getter");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => {
      for await (const x of require("node:stream").Readable.from([made])) return x;
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
  (async () => {
    for (const each of [run]) await each();
  })();
}
{
  console.log("# road-node-stream.change-in-a-closure");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => {
      for await (const x of require("node:stream").Readable.from([made])) return x;
    })();
    const before = [made.label];
    (() => {
      delete again.label;
      again.count = 7;
    })();
    console.log(String(before[0]), String(made.label), again === made);
  }
  (async () => {
    for (const each of [run]) await each();
  })();
}
{
  console.log("# road-node-stream.change-inner-push");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => {
      for await (const x of require("node:stream").Readable.from([made])) return x;
    })();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  (async () => {
    for (const each of [run]) await each();
  })();
}
{
  console.log("# road-node-stream.change-other-kind");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => {
      for await (const x of require("node:stream").Readable.from([made])) return x;
    })();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  (async () => {
    for (const each of [run]) await each();
  })();
}
{
  console.log("# road-node-stream.change-prototype");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => {
      for await (const x of require("node:stream").Readable.from([made])) return x;
    })();
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  (async () => {
    for (const each of [run]) await each();
  })();
}
{
  console.log("# road-node-stream.change-store");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => {
      for await (const x of require("node:stream").Readable.from([made])) return x;
    })();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  (async () => {
    for (const each of [run]) await each();
  })();
}
{
  console.log("# road-node-stream");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => {
      for await (const x of require("node:stream").Readable.from([made])) return x;
    })();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  (async () => {
    for (const each of [run]) await each();
  })();
}
