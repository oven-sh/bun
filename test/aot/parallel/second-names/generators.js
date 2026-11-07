// An object gets a second name (generators), is read, is changed under the second name, and is read again under the first.
{
  console.log("# road-generator-argument.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* (x) {
      yield x;
    })(made).next().value;
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
  console.log("# road-generator-argument.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* (x) {
      yield x;
    })(made).next().value;
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
  console.log("# road-generator-argument.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* (x) {
      yield x;
    })(made).next().value;
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
  console.log("# road-generator-argument.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* (x) {
      yield x;
    })(made).next().value;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-generator-argument.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* (x) {
      yield x;
    })(made).next().value;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-generator-argument.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* (x) {
      yield x;
    })(made).next().value;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-generator-argument.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* (x) {
      yield x;
    })(made).next().value;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-generator-argument");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* (x) {
      yield x;
    })(made).next().value;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-generator-return-call.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {})().return(made).value;
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
  console.log("# road-generator-return-call.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {})().return(made).value;
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
  console.log("# road-generator-return-call.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {})().return(made).value;
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
  console.log("# road-generator-return-call.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {})().return(made).value;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-generator-return-call.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {})().return(made).value;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-generator-return-call.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {})().return(made).value;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-generator-return-call.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {})().return(made).value;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-generator-return-call");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {})().return(made).value;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-generator-return.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {
      return made;
    })().next().value;
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
  console.log("# road-generator-return.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {
      return made;
    })().next().value;
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
  console.log("# road-generator-return.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {
      return made;
    })().next().value;
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
  console.log("# road-generator-return.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {
      return made;
    })().next().value;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-generator-return.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {
      return made;
    })().next().value;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-generator-return.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {
      return made;
    })().next().value;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-generator-return.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {
      return made;
    })().next().value;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-generator-return");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {
      return made;
    })().next().value;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-generator-throw.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (g => (g.next(), g.throw(made).value))(
      (function* () {
        try {
          yield;
        } catch (e) {
          yield e;
        }
      })(),
    );
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
  console.log("# road-generator-throw.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (g => (g.next(), g.throw(made).value))(
      (function* () {
        try {
          yield;
        } catch (e) {
          yield e;
        }
      })(),
    );
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
  console.log("# road-generator-throw.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (g => (g.next(), g.throw(made).value))(
      (function* () {
        try {
          yield;
        } catch (e) {
          yield e;
        }
      })(),
    );
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
  console.log("# road-generator-throw.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (g => (g.next(), g.throw(made).value))(
      (function* () {
        try {
          yield;
        } catch (e) {
          yield e;
        }
      })(),
    );
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-generator-throw.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (g => (g.next(), g.throw(made).value))(
      (function* () {
        try {
          yield;
        } catch (e) {
          yield e;
        }
      })(),
    );
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-generator-throw.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (g => (g.next(), g.throw(made).value))(
      (function* () {
        try {
          yield;
        } catch (e) {
          yield e;
        }
      })(),
    );
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-generator-throw.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (g => (g.next(), g.throw(made).value))(
      (function* () {
        try {
          yield;
        } catch (e) {
          yield e;
        }
      })(),
    );
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-generator-throw");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (g => (g.next(), g.throw(made).value))(
      (function* () {
        try {
          yield;
        } catch (e) {
          yield e;
        }
      })(),
    );
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-sent-in.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (g => (g.next(), g.next(made).value))(
      (function* () {
        yield yield;
      })(),
    );
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
  console.log("# road-sent-in.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (g => (g.next(), g.next(made).value))(
      (function* () {
        yield yield;
      })(),
    );
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
  console.log("# road-sent-in.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (g => (g.next(), g.next(made).value))(
      (function* () {
        yield yield;
      })(),
    );
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
  console.log("# road-sent-in.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (g => (g.next(), g.next(made).value))(
      (function* () {
        yield yield;
      })(),
    );
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-sent-in.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (g => (g.next(), g.next(made).value))(
      (function* () {
        yield yield;
      })(),
    );
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-sent-in.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (g => (g.next(), g.next(made).value))(
      (function* () {
        yield yield;
      })(),
    );
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-sent-in.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (g => (g.next(), g.next(made).value))(
      (function* () {
        yield yield;
      })(),
    );
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-sent-in");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (g => (g.next(), g.next(made).value))(
      (function* () {
        yield yield;
      })(),
    );
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-yield-star-result.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {
      yield yield* (function* () {
        return made;
      })();
    })().next().value;
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
  console.log("# road-yield-star-result.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {
      yield yield* (function* () {
        return made;
      })();
    })().next().value;
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
  console.log("# road-yield-star-result.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {
      yield yield* (function* () {
        return made;
      })();
    })().next().value;
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
  console.log("# road-yield-star-result.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {
      yield yield* (function* () {
        return made;
      })();
    })().next().value;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-yield-star-result.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {
      yield yield* (function* () {
        return made;
      })();
    })().next().value;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-yield-star-result.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {
      yield yield* (function* () {
        return made;
      })();
    })().next().value;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-yield-star-result.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {
      yield yield* (function* () {
        return made;
      })();
    })().next().value;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-yield-star-result");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {
      yield yield* (function* () {
        return made;
      })();
    })().next().value;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-yield-star.change-freeze");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {
      yield* [made];
    })().next().value;
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
  console.log("# road-yield-star.change-getter");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {
      yield* [made];
    })().next().value;
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
  console.log("# road-yield-star.change-in-a-closure");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {
      yield* [made];
    })().next().value;
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
  console.log("# road-yield-star.change-inner-push");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {
      yield* [made];
    })().next().value;
    const before = [made.label];
    again.inner.push(2);
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-yield-star.change-other-kind");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {
      yield* [made];
    })().next().value;
    const before = [made.label];
    again.count = "text";
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-yield-star.change-prototype");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {
      yield* [made];
    })().next().value;
    const before = [made.label];
    Object.setPrototypeOf(again, { inherited: 1, label: 0 });
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-yield-star.change-store");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {
      yield* [made];
    })().next().value;
    const before = [made.label];
    again.added = 2;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
{
  console.log("# road-yield-star");
  function run() {
    const made = { count: 1, label: "two", inner: [1] };
    const again = (function* () {
      yield* [made];
    })().next().value;
    const before = [made.label];
    delete again.label;
    console.log(String(before[0]), String(made.label), again === made);
  }
  for (const each of [run]) each();
}
