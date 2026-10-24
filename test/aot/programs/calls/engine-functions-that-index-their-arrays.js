function describe(error) {
  if (error instanceof SuppressedError) return `SuppressedError(error: ${describe(error.error)}; suppressed: ${describe(error.suppressed)})`;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function attempt(label, body) {
  try {
    console.log(label, String(body()));
  } catch (error) {
    console.log(label, "threw", describe(error));
  }
}

async function attemptAsync(label, body) {
  try {
    console.log(label, String(await body()));
  } catch (error) {
    console.log(label, "threw", describe(error));
  }
}

const indexes = [-1, 0, 2, 3, -3, -4, NaN, -0, 1.9, -1.9, Infinity, -Infinity, "1", "x", undefined, null, true, { valueOf: () => 1 }, 2 ** 53, -(2 ** 53)];
for (const view of [new Uint8Array([10, 20, 30]), new Float64Array([1.5, -0, NaN]), new BigInt64Array([1n, -2n, 3n]), new Uint8Array(0)]) {
  attempt(`${view.constructor.name} at`, () => indexes.map(index => Object.is(view.at(index), -0) ? "-0" : String(view.at(index))).join(" "));
}
attempt("at without an argument", () => new Uint8Array([7, 8]).at());
attempt("at with a BigInt", () => new Uint8Array([7, 8]).at(1n));
attempt("at with a symbol", () => new Uint8Array([7, 8]).at(Symbol.iterator));
attempt("at on an array", () => Uint8Array.prototype.at.call([1, 2], 0));
attempt("at on undefined", () => Uint8Array.prototype.at.call(undefined, 0));
attempt("at after the index shrinks the buffer", () => {
  const buffer = new ArrayBuffer(4, { maxByteLength: 8 });
  const view = new Uint8Array(buffer).fill(9);
  return view.at({ valueOf: () => (buffer.resize(1), 2) });
});
attempt("at after the index detaches the buffer", () => {
  const view = new Uint8Array([1, 2, 3]);
  return view.at({ valueOf: () => (view.buffer.transfer(), 1) });
});

attempt("toLocaleString of numbers", () => new Float64Array([1234.5, 0.25, NaN, -0, Infinity]).toLocaleString("en-US"));
attempt("toLocaleString with options", () => new Float64Array([1234.5, 0.25]).toLocaleString("de", { minimumFractionDigits: 2 }));
attempt("toLocaleString of BigInts", () => new BigInt64Array([1234567n, -8n]).toLocaleString("en-US"));
attempt("toLocaleString of nothing", () => JSON.stringify(new Uint8Array(0).toLocaleString("en-US")));
attempt("toLocaleString with a locale that does not exist", () => new Uint8Array([1]).toLocaleString("not a locale"));
attempt("toLocaleString on an array", () => Uint8Array.prototype.toLocaleString.call([1, 2]));
attempt("length of toLocaleString and at", () => [Uint8Array.prototype.toLocaleString.length, Uint8Array.prototype.at.length]);

function withNumberMethod(method, body) {
  const original = Number.prototype.toLocaleString;
  Number.prototype.toLocaleString = method;
  try {
    return body();
  } finally {
    Number.prototype.toLocaleString = original;
  }
}
attempt("toLocaleString calls what the program put on Number.prototype", () =>
  withNumberMethod(
    function (...operands) {
      "use strict";
      return `${typeof this} ${this} ${operands.length} ${operands.join("/")}`;
    },
    () => [new Uint8Array([1, 2]).toLocaleString("de", "options", "surplus"), new Uint8Array([3]).toLocaleString()].join(" | "),
  ),
);
attempt("toLocaleString converts what the method answers", () =>
  withNumberMethod(
    () => ({ toString: () => "converted" }),
    () => new Uint8Array([1, 2]).toLocaleString(),
  ),
);
attempt("toLocaleString does not convert a symbol", () =>
  withNumberMethod(
    () => Symbol.iterator,
    () => new Uint8Array([1]).toLocaleString(),
  ),
);
attempt("toLocaleString skips the elements that the method removes", () => {
  const buffer = new ArrayBuffer(4, { maxByteLength: 8 });
  const view = new Uint8Array(buffer).fill(5);
  return withNumberMethod(
    function () {
      buffer.resize(2);
      return `<${this}>`;
    },
    () => view.toLocaleString(),
  );
});

const order = [];
const resource = name => ({ [Symbol.dispose]: () => void order.push(name) });
const failing = name => ({
  [Symbol.dispose]() {
    order.push(name);
    throw new RangeError(name);
  },
});
function takeOrder() {
  return order.splice(0).join(" ");
}

attempt("dispose runs last in, first out", () => {
  const stack = new DisposableStack();
  stack.use(resource("used"));
  stack.use(null);
  stack.use(undefined);
  stack.adopt("value", value => order.push(`adopted ${value}`));
  stack.defer(() => order.push("deferred"));
  const result = stack.dispose();
  stack.dispose();
  return `${takeOrder()} | ${result} ${stack.disposed}`;
});
attempt("dispose of many", () => {
  const stack = new DisposableStack();
  let sum = 0;
  for (let number = 1; number <= 3000; number++) stack.defer(() => void (sum = (sum * 31 + number) % 1000003));
  stack.dispose();
  return sum;
});
attempt("dispose keeps every error", () => {
  const stack = new DisposableStack();
  stack.use(failing("first"));
  stack.use(resource("second"));
  stack.use(failing("third"));
  stack.defer(() => {
    throw undefined;
  });
  stack.dispose();
});
console.log(takeOrder());
attempt("a callback sees the stack disposed", () => {
  const stack = new DisposableStack();
  stack.defer(() => stack.defer(() => order.push("never")));
  stack.dispose();
});
attempt("move takes the resources along", () => {
  const stack = new DisposableStack();
  stack.use(resource("moved"));
  const moved = stack.move();
  stack.dispose();
  const before = takeOrder();
  moved.dispose();
  return `[${before}] [${takeOrder()}] ${stack.disposed} ${moved.disposed}`;
});
attempt("use after dispose", () => {
  const stack = new DisposableStack();
  stack.dispose();
  stack.use(resource("late"));
});
attempt("use of a number", () => new DisposableStack().use(1));
attempt("use of an object without the method", () => new DisposableStack().use({}));
attempt("use of an object whose method is no function", () => new DisposableStack().use({ [Symbol.dispose]: 1 }));
attempt("defer of no function", () => new DisposableStack().defer(1));
attempt("adopt of no function", () => new DisposableStack().adopt(1, 1));
attempt("dispose on an object", () => DisposableStack.prototype.dispose.call({}));
attempt("dispose on an AsyncDisposableStack", () => DisposableStack.prototype.dispose.call(new AsyncDisposableStack()));
attempt("the method is read once, when the resource is added", () => {
  const stack = new DisposableStack();
  let reads = 0;
  const held = {
    get [Symbol.dispose]() {
      reads++;
      return () => order.push("first method");
    },
  };
  stack.use(held);
  stack.dispose();
  return `${reads} ${takeOrder()}`;
});
attempt("the receiver of the method is the resource", () => {
  const stack = new DisposableStack();
  const held = {
    [Symbol.dispose]() {
      order.push(this === held);
    },
  };
  stack.use(held);
  stack.defer(function () {
    "use strict";
    order.push(this);
  });
  stack.dispose();
  return takeOrder();
});

const asyncResource = name => ({
  async [Symbol.asyncDispose]() {
    order.push(`${name} begins`);
    await undefined;
    order.push(`${name} ends`);
  },
});
await attemptAsync("disposeAsync waits for each", async () => {
  const stack = new AsyncDisposableStack();
  stack.use(asyncResource("first"));
  stack.use(resource("synchronous"));
  stack.use(null);
  stack.adopt("value", async value => void order.push(`adopted ${value}`));
  stack.defer(() => void order.push("deferred"));
  const promise = stack.disposeAsync();
  order.push("returned");
  const result = await promise;
  return `${takeOrder()} | ${result} ${stack.disposed} ${await stack.disposeAsync()}`;
});
await attemptAsync("disposeAsync of null alone still waits", async () => {
  const stack = new AsyncDisposableStack();
  stack.use(null);
  const promise = stack.disposeAsync().then(() => order.push("disposed"));
  Promise.resolve().then(() => order.push("one turn"));
  await promise;
  return takeOrder();
});
await attemptAsync("disposeAsync keeps every error", async () => {
  const stack = new AsyncDisposableStack();
  stack.use(failing("thrown"));
  stack.defer(() => Promise.reject(new TypeError("rejected")));
  stack.use({
    [Symbol.asyncDispose]() {
      throw new EvalError("thrown by the asynchronous method");
    },
  });
  await stack.disposeAsync();
});
console.log(takeOrder());
await attemptAsync("disposeAsync of many", async () => {
  const stack = new AsyncDisposableStack();
  let sum = 0;
  for (let number = 1; number <= 300; number++) stack.defer(async () => void (sum = (sum * 31 + number) % 1000003));
  await stack.disposeAsync();
  return sum;
});
await attemptAsync("disposeAsync on an object rejects", () => AsyncDisposableStack.prototype.disposeAsync.call({}));
await attemptAsync("move takes the asynchronous resources along", async () => {
  const stack = new AsyncDisposableStack();
  stack.use(asyncResource("moved"));
  const moved = stack.move();
  await stack.disposeAsync();
  const before = takeOrder();
  await moved.disposeAsync();
  return `[${before}] [${takeOrder()}]`;
});
