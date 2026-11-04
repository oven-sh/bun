// An object gets a second name (after a wait), is read, is changed under the second name, and is read again under the first.
{
  console.log("# road-await-timer.change-in-a-closure");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => setTimeout(r, 0, made));
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
  console.log("# road-await-timer.change-inner-push");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => setTimeout(r, 0, made));
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-timer.change-other-kind");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => setTimeout(r, 0, made));
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-timer.change-prototype");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => setTimeout(r, 0, made));
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-timer.change-store");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => setTimeout(r, 0, made));
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-timer");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await new Promise(r => setTimeout(r, 0, made));
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-with-resolvers.change-freeze");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (w => (w.resolve(made), w.promise))(Promise.withResolvers());
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
  console.log("# road-await-with-resolvers.change-getter");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (w => (w.resolve(made), w.promise))(Promise.withResolvers());
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
  console.log("# road-await-with-resolvers.change-in-a-closure");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (w => (w.resolve(made), w.promise))(Promise.withResolvers());
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
  console.log("# road-await-with-resolvers.change-inner-push");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (w => (w.resolve(made), w.promise))(Promise.withResolvers());
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-with-resolvers.change-other-kind");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (w => (w.resolve(made), w.promise))(Promise.withResolvers());
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-with-resolvers.change-prototype");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (w => (w.resolve(made), w.promise))(Promise.withResolvers());
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-with-resolvers.change-store");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (w => (w.resolve(made), w.promise))(Promise.withResolvers());
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await-with-resolvers");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (w => (w.resolve(made), w.promise))(Promise.withResolvers());
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await.change-freeze");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await made;
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
  console.log("# road-await.change-getter");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await made;
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
  console.log("# road-await.change-in-a-closure");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await made;
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
  console.log("# road-await.change-inner-push");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await made;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await.change-other-kind");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await made;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await.change-prototype");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await made;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await.change-store");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await made;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-await");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await made;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-for-await.change-freeze");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => {
      for await (const x of [made]) return x;
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
  console.log("# road-for-await.change-getter");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => {
      for await (const x of [made]) return x;
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
  console.log("# road-for-await.change-in-a-closure");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => {
      for await (const x of [made]) return x;
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
  console.log("# road-for-await.change-inner-push");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => {
      for await (const x of [made]) return x;
    })();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-for-await.change-other-kind");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => {
      for await (const x of [made]) return x;
    })();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-for-await.change-prototype");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => {
      for await (const x of [made]) return x;
    })();
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-for-await.change-store");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => {
      for await (const x of [made]) return x;
    })();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-for-await");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = await (async () => {
      for await (const x of [made]) return x;
    })();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-from-async.change-freeze");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (await Array.fromAsync([made]))[0];
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
  console.log("# road-from-async.change-getter");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (await Array.fromAsync([made]))[0];
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
  console.log("# road-from-async.change-in-a-closure");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (await Array.fromAsync([made]))[0];
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
  console.log("# road-from-async.change-inner-push");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (await Array.fromAsync([made]))[0];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-from-async.change-other-kind");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (await Array.fromAsync([made]))[0];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-from-async.change-prototype");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (await Array.fromAsync([made]))[0];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-from-async.change-store");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (await Array.fromAsync([made]))[0];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-from-async");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (await Array.fromAsync([made]))[0];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-stream.change-freeze");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      await new ReadableStream({
        start(c) {
          c.enqueue(made);
          c.close();
        },
      })
        .getReader()
        .read()
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
  console.log("# road-stream.change-getter");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      await new ReadableStream({
        start(c) {
          c.enqueue(made);
          c.close();
        },
      })
        .getReader()
        .read()
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
  console.log("# road-stream.change-in-a-closure");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      await new ReadableStream({
        start(c) {
          c.enqueue(made);
          c.close();
        },
      })
        .getReader()
        .read()
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
  console.log("# road-stream.change-inner-push");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      await new ReadableStream({
        start(c) {
          c.enqueue(made);
          c.close();
        },
      })
        .getReader()
        .read()
    ).value;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-stream.change-other-kind");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      await new ReadableStream({
        start(c) {
          c.enqueue(made);
          c.close();
        },
      })
        .getReader()
        .read()
    ).value;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-stream.change-prototype");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      await new ReadableStream({
        start(c) {
          c.enqueue(made);
          c.close();
        },
      })
        .getReader()
        .read()
    ).value;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-stream.change-store");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      await new ReadableStream({
        start(c) {
          c.enqueue(made);
          c.close();
        },
      })
        .getReader()
        .read()
    ).value;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
{
  console.log("# road-stream");
  async function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (
      await new ReadableStream({
        start(c) {
          c.enqueue(made);
          c.close();
        },
      })
        .getReader()
        .read()
    ).value;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) await each();
}
