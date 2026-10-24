function describe(error) {
  if (error instanceof SuppressedError)
    return `SuppressedError(${error.message}; error: ${describe(error.error)}; suppressed: ${describe(error.suppressed)})`;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

const order = [];
async function attempt(label, body) {
  try {
    console.log(label, "returned", await body());
  } catch (error) {
    console.log(label, "threw", describe(error));
  }
  console.log(order.join(" "));
  order.length = 0;
}

const syncResource = name => ({
  [Symbol.dispose]() {
    order.push(name);
  },
});
const failingSyncResource = name => ({
  [Symbol.dispose]() {
    order.push(name);
    throw new RangeError(name);
  },
});
const asyncResource = name => ({
  async [Symbol.asyncDispose]() {
    order.push(`${name} begins`);
    await undefined;
    order.push(`${name} ends`);
  },
});
const rejectingResource = name => ({
  async [Symbol.asyncDispose]() {
    order.push(name);
    await undefined;
    throw new RangeError(name);
  },
});

await attempt("null", async () => {
  await using x = null;
  order.push("body");
  return "nothing to dispose";
});
await attempt("undefined and a plain resource", async () => {
  {
    using a = syncResource("a");
    await using b = undefined;
    using c = syncResource("c");
    order.push("body");
  }
  order.push("after");
  return "finished";
});
await attempt("number", async () => {
  await using x = 5;
  return "unreachable";
});
await attempt("no method", async () => {
  await using x = {};
  return "unreachable";
});
await attempt("only Symbol.dispose", async () => {
  {
    await using x = syncResource("x");
    order.push("body");
  }
  order.push("after");
  return "finished";
});
await attempt("both methods", async () => {
  await using x = { ...syncResource("sync"), ...asyncResource("async") };
  return "finished";
});
await attempt("mixed with using", async () => {
  await using a = asyncResource("a");
  using b = syncResource("b");
  await using c = asyncResource("c");
  using d = syncResource("d");
  order.push("body");
  return "finished";
});
await attempt("plain failure under await using", async () => {
  await using a = asyncResource("a");
  using b = failingSyncResource("b");
  return "unreachable";
});
await attempt("body throws, asyncDispose rejects", async () => {
  await using a = rejectingResource("a");
  throw new EvalError("body");
});
await attempt("body throws, two reject", async () => {
  await using a = rejectingResource("a");
  await using b = rejectingResource("b");
  throw new EvalError("body");
});
await attempt("body throws, plain and asynchronous fail", async () => {
  await using a = rejectingResource("a");
  using b = failingSyncResource("b");
  throw new EvalError("body");
});
await attempt("body throws undefined, asyncDispose rejects", async () => {
  await using a = rejectingResource("a");
  throw undefined;
});
await attempt("two reject", async () => {
  await using a = rejectingResource("a");
  await using b = rejectingResource("b");
  return "unreachable";
});
await attempt("second declaration is invalid", async () => {
  await using a = asyncResource("a");
  await using b = 5;
  return "unreachable";
});
await attempt("asyncDispose resolves", async () => {
  await using a = asyncResource("a");
  order.push("body");
  return "finished";
});
