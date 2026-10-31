// An object gets a second name (the library), is read, is changed under the second name, and is read again under the first.
{
  console.log("# road-abort-reason.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      const c = new AbortController();
      c.abort(made);
      return c.signal.reason;
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
  console.log("# road-abort-reason.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      const c = new AbortController();
      c.abort(made);
      return c.signal.reason;
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
  console.log("# road-abort-reason.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      const c = new AbortController();
      c.abort(made);
      return c.signal.reason;
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
  console.log("# road-abort-reason.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      const c = new AbortController();
      c.abort(made);
      return c.signal.reason;
    })();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-abort-reason.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      const c = new AbortController();
      c.abort(made);
      return c.signal.reason;
    })();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-abort-reason.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      const c = new AbortController();
      c.abort(made);
      return c.signal.reason;
    })();
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-abort-reason.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      const c = new AbortController();
      c.abort(made);
      return c.signal.reason;
    })();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-abort-reason");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      const c = new AbortController();
      c.abort(made);
      return c.signal.reason;
    })();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-abort-signal.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = AbortSignal.abort(made).reason;
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
  console.log("# road-abort-signal.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = AbortSignal.abort(made).reason;
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
  console.log("# road-abort-signal.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = AbortSignal.abort(made).reason;
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
  console.log("# road-abort-signal.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = AbortSignal.abort(made).reason;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-abort-signal.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = AbortSignal.abort(made).reason;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-abort-signal.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = AbortSignal.abort(made).reason;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-abort-signal.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = AbortSignal.abort(made).reason;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-abort-signal");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = AbortSignal.abort(made).reason;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-custom-event.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new CustomEvent("x", { detail: made }).detail;
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
  console.log("# road-custom-event.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new CustomEvent("x", { detail: made }).detail;
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
  console.log("# road-custom-event.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new CustomEvent("x", { detail: made }).detail;
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
  console.log("# road-custom-event.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new CustomEvent("x", { detail: made }).detail;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-custom-event.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new CustomEvent("x", { detail: made }).detail;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-custom-event.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new CustomEvent("x", { detail: made }).detail;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-custom-event.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new CustomEvent("x", { detail: made }).detail;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-custom-event");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new CustomEvent("x", { detail: made }).detail;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-event-target.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      const t = new EventTarget();
      t.addEventListener("x", e => {
        got = e.detail;
      });
      t.dispatchEvent(new CustomEvent("x", { detail: made }));
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
  console.log("# road-event-target.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      const t = new EventTarget();
      t.addEventListener("x", e => {
        got = e.detail;
      });
      t.dispatchEvent(new CustomEvent("x", { detail: made }));
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
  console.log("# road-event-target.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      const t = new EventTarget();
      t.addEventListener("x", e => {
        got = e.detail;
      });
      t.dispatchEvent(new CustomEvent("x", { detail: made }));
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
  console.log("# road-event-target.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      const t = new EventTarget();
      t.addEventListener("x", e => {
        got = e.detail;
      });
      t.dispatchEvent(new CustomEvent("x", { detail: made }));
      return got;
    })();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-event-target.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      const t = new EventTarget();
      t.addEventListener("x", e => {
        got = e.detail;
      });
      t.dispatchEvent(new CustomEvent("x", { detail: made }));
      return got;
    })();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-event-target.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      const t = new EventTarget();
      t.addEventListener("x", e => {
        got = e.detail;
      });
      t.dispatchEvent(new CustomEvent("x", { detail: made }));
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
  console.log("# road-event-target.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      const t = new EventTarget();
      t.addEventListener("x", e => {
        got = e.detail;
      });
      t.dispatchEvent(new CustomEvent("x", { detail: made }));
      return got;
    })();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-event-target");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      const t = new EventTarget();
      t.addEventListener("x", e => {
        got = e.detail;
      });
      t.dispatchEvent(new CustomEvent("x", { detail: made }));
      return got;
    })();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-global-var.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((globalThis.heldHere = made), heldHere);
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
  console.log("# road-global-var.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((globalThis.heldHere = made), heldHere);
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
  console.log("# road-global-var.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((globalThis.heldHere = made), heldHere);
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
  console.log("# road-global-var.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((globalThis.heldHere = made), heldHere);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-global-var.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((globalThis.heldHere = made), heldHere);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-global-var.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((globalThis.heldHere = made), heldHere);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-global-var.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((globalThis.heldHere = made), heldHere);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-global-var");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = ((globalThis.heldHere = made), heldHere);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-peek.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Bun.peek(Promise.resolve(made));
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
  console.log("# road-peek.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Bun.peek(Promise.resolve(made));
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
  console.log("# road-peek.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Bun.peek(Promise.resolve(made));
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
  console.log("# road-peek.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Bun.peek(Promise.resolve(made));
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-peek.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Bun.peek(Promise.resolve(made));
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-peek.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Bun.peek(Promise.resolve(made));
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-peek.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Bun.peek(Promise.resolve(made));
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-peek");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = Bun.peek(Promise.resolve(made));
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-process-emit.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      process.once("held", v => {
        got = v;
      });
      process.emit("held", made);
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
  console.log("# road-process-emit.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      process.once("held", v => {
        got = v;
      });
      process.emit("held", made);
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
  console.log("# road-process-emit.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      process.once("held", v => {
        got = v;
      });
      process.emit("held", made);
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
  console.log("# road-process-emit.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      process.once("held", v => {
        got = v;
      });
      process.emit("held", made);
      return got;
    })();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-process-emit.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      process.once("held", v => {
        got = v;
      });
      process.emit("held", made);
      return got;
    })();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-process-emit.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      process.once("held", v => {
        got = v;
      });
      process.emit("held", made);
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
  console.log("# road-process-emit.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      process.once("held", v => {
        got = v;
      });
      process.emit("held", made);
      return got;
    })();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-process-emit");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      process.once("held", v => {
        got = v;
      });
      process.emit("held", made);
      return got;
    })();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
