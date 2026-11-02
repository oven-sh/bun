// An object gets a second name (functions and expressions), is read, is changed under the second name, and is read again under the first.
{
  console.log("# road-list-pattern-default.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([x = made]) => x)([]);
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
  console.log("# road-list-pattern-default.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([x = made]) => x)([]);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-list-pattern-default.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([x = made]) => x)([]);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-list-pattern-default.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([x = made]) => x)([]);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-list-pattern-default.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([x = made]) => x)([]);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-list-pattern-default");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (([x = made]) => x)([]);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-loop-variable.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x = null;
      for (let i = 0; i < 2; i++) x = i ? made : x;
      return x;
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
  console.log("# road-loop-variable.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x = null;
      for (let i = 0; i < 2; i++) x = i ? made : x;
      return x;
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
  console.log("# road-loop-variable.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x = null;
      for (let i = 0; i < 2; i++) x = i ? made : x;
      return x;
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
  console.log("# road-loop-variable.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x = null;
      for (let i = 0; i < 2; i++) x = i ? made : x;
      return x;
    })();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-loop-variable.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x = null;
      for (let i = 0; i < 2; i++) x = i ? made : x;
      return x;
    })();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-loop-variable.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x = null;
      for (let i = 0; i < 2; i++) x = i ? made : x;
      return x;
    })();
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-loop-variable.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x = null;
      for (let i = 0; i < 2; i++) x = i ? made : x;
      return x;
    })();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-loop-variable");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x = null;
      for (let i = 0; i < 2; i++) x = i ? made : x;
      return x;
    })();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-nested-pattern.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ a: [{ b }] }) => b)({ a: [{ b: made }] });
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
  console.log("# road-nested-pattern.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ a: [{ b }] }) => b)({ a: [{ b: made }] });
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
  console.log("# road-nested-pattern.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ a: [{ b }] }) => b)({ a: [{ b: made }] });
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
  console.log("# road-nested-pattern.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ a: [{ b }] }) => b)({ a: [{ b: made }] });
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-nested-pattern.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ a: [{ b }] }) => b)({ a: [{ b: made }] });
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-nested-pattern.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ a: [{ b }] }) => b)({ a: [{ b: made }] });
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-nested-pattern.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ a: [{ b }] }) => b)({ a: [{ b: made }] });
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-nested-pattern");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ a: [{ b }] }) => b)({ a: [{ b: made }] });
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-new-function.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Function("x", "return x")(made);
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
  console.log("# road-new-function.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Function("x", "return x")(made);
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
  console.log("# road-new-function.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Function("x", "return x")(made);
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
  console.log("# road-new-function.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Function("x", "return x")(made);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-new-function.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Function("x", "return x")(made);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-new-function.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Function("x", "return x")(made);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-new-function.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Function("x", "return x")(made);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-new-function");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = new Function("x", "return x")(made);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-nullish-assignment.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x;
      x ??= made;
      return x;
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
  console.log("# road-nullish-assignment.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x;
      x ??= made;
      return x;
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
  console.log("# road-nullish-assignment.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x;
      x ??= made;
      return x;
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
  console.log("# road-nullish-assignment.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x;
      x ??= made;
      return x;
    })();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-nullish-assignment.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x;
      x ??= made;
      return x;
    })();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-nullish-assignment.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x;
      x ??= made;
      return x;
    })();
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-nullish-assignment.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x;
      x ??= made;
      return x;
    })();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-nullish-assignment");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x;
      x ??= made;
      return x;
    })();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-nullish.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = null ?? made;
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
  console.log("# road-nullish.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = null ?? made;
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
  console.log("# road-nullish.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = null ?? made;
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
  console.log("# road-nullish.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = null ?? made;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-nullish.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = null ?? made;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-nullish.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = null ?? made;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-nullish.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = null ?? made;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-nullish");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = null ?? made;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-number-member.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { 1: made }[1];
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
  console.log("# road-number-member.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { 1: made }[1];
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
  console.log("# road-number-member.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { 1: made }[1];
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
  console.log("# road-number-member.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { 1: made }[1];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-number-member.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { 1: made }[1];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-number-member.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { 1: made }[1];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-number-member.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { 1: made }[1];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-number-member");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { 1: made }[1];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-object-rest.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ ...r }) => r.a)({ a: made });
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
  console.log("# road-object-rest.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ ...r }) => r.a)({ a: made });
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
  console.log("# road-object-rest.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ ...r }) => r.a)({ a: made });
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
  console.log("# road-object-rest.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ ...r }) => r.a)({ a: made });
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-object-rest.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ ...r }) => r.a)({ a: made });
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-object-rest.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ ...r }) => r.a)({ a: made });
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-object-rest.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ ...r }) => r.a)({ a: made });
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-object-rest");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ ...r }) => r.a)({ a: made });
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-optional-call.change-freeze");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same?.(made);
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
  console.log("# road-optional-call.change-getter");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same?.(made);
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
  console.log("# road-optional-call.change-in-a-closure");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same?.(made);
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
  console.log("# road-optional-call.change-inner-push");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same?.(made);
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-optional-call.change-other-kind");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same?.(made);
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-optional-call.change-prototype");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same?.(made);
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-optional-call.change-store");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same?.(made);
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-optional-call");
  function same(x) {
    return x;
  }
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = same?.(made);
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-optional-member.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { a: { b: made } }?.a?.b;
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
  console.log("# road-optional-member.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { a: { b: made } }?.a?.b;
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
  console.log("# road-optional-member.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { a: { b: made } }?.a?.b;
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
  console.log("# road-optional-member.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { a: { b: made } }?.a?.b;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-optional-member.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { a: { b: made } }?.a?.b;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-optional-member.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { a: { b: made } }?.a?.b;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-optional-member.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { a: { b: made } }?.a?.b;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-optional-member");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = { a: { b: made } }?.a?.b;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-or-assignment.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x = 0;
      x ||= made;
      return x;
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
  console.log("# road-or-assignment.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x = 0;
      x ||= made;
      return x;
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
  console.log("# road-or-assignment.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x = 0;
      x ||= made;
      return x;
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
  console.log("# road-or-assignment.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x = 0;
      x ||= made;
      return x;
    })();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-or-assignment.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x = 0;
      x ||= made;
      return x;
    })();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-or-assignment.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x = 0;
      x ||= made;
      return x;
    })();
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-or-assignment.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x = 0;
      x ||= made;
      return x;
    })();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-or-assignment");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let x = 0;
      x ||= made;
      return x;
    })();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-own-iterator.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [
      ...{
        *[Symbol.iterator]() {
          yield made;
        },
      },
    ][0];
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
  console.log("# road-own-iterator.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [
      ...{
        *[Symbol.iterator]() {
          yield made;
        },
      },
    ][0];
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
  console.log("# road-own-iterator.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [
      ...{
        *[Symbol.iterator]() {
          yield made;
        },
      },
    ][0];
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
  console.log("# road-own-iterator.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [
      ...{
        *[Symbol.iterator]() {
          yield made;
        },
      },
    ][0];
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-own-iterator.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [
      ...{
        *[Symbol.iterator]() {
          yield made;
        },
      },
    ][0];
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-own-iterator.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [
      ...{
        *[Symbol.iterator]() {
          yield made;
        },
      },
    ][0];
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-own-iterator.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [
      ...{
        *[Symbol.iterator]() {
          yield made;
        },
      },
    ][0];
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-own-iterator");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = [
      ...{
        *[Symbol.iterator]() {
          yield made;
        },
      },
    ][0];
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-pattern-default.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ a = made }) => a)({});
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
  console.log("# road-pattern-default.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ a = made }) => a)({});
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
  console.log("# road-pattern-default.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ a = made }) => a)({});
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
  console.log("# road-pattern-default.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ a = made }) => a)({});
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-pattern-default.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ a = made }) => a)({});
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-pattern-default.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ a = made }) => a)({});
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-pattern-default.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ a = made }) => a)({});
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-pattern-default");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (({ a = made }) => a)({});
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-pattern-into-member.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      const h = {};
      ({ a: h.x } = { a: made });
      return h.x;
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
  console.log("# road-pattern-into-member.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      const h = {};
      ({ a: h.x } = { a: made });
      return h.x;
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
  console.log("# road-pattern-into-member.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      const h = {};
      ({ a: h.x } = { a: made });
      return h.x;
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
  console.log("# road-pattern-into-member.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      const h = {};
      ({ a: h.x } = { a: made });
      return h.x;
    })();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-pattern-into-member.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      const h = {};
      ({ a: h.x } = { a: made });
      return h.x;
    })();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-pattern-into-member.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      const h = {};
      ({ a: h.x } = { a: made });
      return h.x;
    })();
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-pattern-into-member.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      const h = {};
      ({ a: h.x } = { a: made });
      return h.x;
    })();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-pattern-into-member");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      const h = {};
      ({ a: h.x } = { a: made });
      return h.x;
    })();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-replacer-holder.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      JSON.stringify(made, function (k, v) {
        if (k === "count") got = this;
        return v;
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
  console.log("# road-replacer-holder.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      JSON.stringify(made, function (k, v) {
        if (k === "count") got = this;
        return v;
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
  console.log("# road-replacer-holder.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      JSON.stringify(made, function (k, v) {
        if (k === "count") got = this;
        return v;
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
  console.log("# road-replacer-holder.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      JSON.stringify(made, function (k, v) {
        if (k === "count") got = this;
        return v;
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
  console.log("# road-replacer-holder.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      JSON.stringify(made, function (k, v) {
        if (k === "count") got = this;
        return v;
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
  console.log("# road-replacer-holder.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      JSON.stringify(made, function (k, v) {
        if (k === "count") got = this;
        return v;
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
  console.log("# road-replacer-holder.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      JSON.stringify(made, function (k, v) {
        if (k === "count") got = this;
        return v;
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
  console.log("# road-replacer-holder");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      JSON.stringify(made, function (k, v) {
        if (k === "count") got = this;
        return v;
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
  console.log("# road-replacer-root.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      JSON.stringify(made, (k, v) => (k === "" ? ((got = v), 0) : v));
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
  console.log("# road-replacer-root.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      JSON.stringify(made, (k, v) => (k === "" ? ((got = v), 0) : v));
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
  console.log("# road-replacer-root.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      JSON.stringify(made, (k, v) => (k === "" ? ((got = v), 0) : v));
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
  console.log("# road-replacer-root.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      JSON.stringify(made, (k, v) => (k === "" ? ((got = v), 0) : v));
      return got;
    })();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-replacer-root.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      JSON.stringify(made, (k, v) => (k === "" ? ((got = v), 0) : v));
      return got;
    })();
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-replacer-root.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      JSON.stringify(made, (k, v) => (k === "" ? ((got = v), 0) : v));
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
  console.log("# road-replacer-root.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      JSON.stringify(made, (k, v) => (k === "" ? ((got = v), 0) : v));
      return got;
    })();
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-replacer-root");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      JSON.stringify(made, (k, v) => (k === "" ? ((got = v), 0) : v));
      return got;
    })();
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-replacer-value.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      JSON.stringify({ a: made }, (k, v) => (k === "a" ? ((got = v), 0) : v));
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
  console.log("# road-replacer-value.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      JSON.stringify({ a: made }, (k, v) => (k === "a" ? ((got = v), 0) : v));
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
  console.log("# road-replacer-value.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      JSON.stringify({ a: made }, (k, v) => (k === "a" ? ((got = v), 0) : v));
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
  console.log("# road-replacer-value.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (() => {
      let got;
      JSON.stringify({ a: made }, (k, v) => (k === "a" ? ((got = v), 0) : v));
      return got;
    })();
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
