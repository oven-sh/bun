// Prints the frames of errors thrown while the resources of `using` declarations are disposed. The function around a declaration is listed at its end.
function fail() {
  throw new Error("fail");
}
function framesOf(error) {
  return String(error.stack)
    .split("\n")
    .map(text => /^\s*at (.*?) ?\(?[^ ()]*stack-positions-under-using-declarations\.mjs:(\d+):(\d+)\)?$/.exec(text))
    .filter(found => found !== null)
    .map(found => found[1] + "@" + found[2] + ":" + found[3])
    .join(" < ");
}
async function show(label, run) {
  try {
    await run();
    console.log(label, "| no error");
  } catch (error) {
    console.log(
      label,
      "|",
      error.constructor.name,
      "|",
      framesOf(error),
      error.suppressed ? "| suppressed: " + framesOf(error.suppressed) : "",
    );
  }
}
const resource = dispose => ({ [Symbol.dispose]: dispose });
const asyncResource = dispose => ({ [Symbol.asyncDispose]: dispose });
class Handle {
  constructor(name) {
    this.name = name;
  }
  [Symbol.dispose]() {
    fail();
  }
}
await show("dispose throws", () => {
  using first = resource(() => fail());
  return 1;
});
await show("the second of two", () => {
  using first = resource(() => {});
  using second = resource(() => fail());
  first;
});
await show("a method of a class", () => {
  using handle = new Handle("a");
  handle.name;
});
await show("the initializer throws", () => {
  using first = resource(() => {});
  using second = fail();
});
await show("the body throws and so does dispose", () => {
  using first = resource(() => fail());
  fail();
});
await show("no dispose method", () => {
  using first = {};
});
await show("in a block", () => {
  {
    using first = resource(() => fail());
  }
  return 2;
});
await show("in a for-of head", () => {
  for (using item of [resource(() => fail())]) {
    item;
  }
});
await show("await using", async () => {
  await using first = asyncResource(async () => {
    await null;
    fail();
  });
});
await show("await using of a sync resource", async () => {
  await using first = resource(() => fail());
});
await show("behind an await", async () => {
  using first = resource(() => fail());
  await null;
});
await show("DisposableStack", () => {
  using stack = new DisposableStack();
  stack.defer(() => fail());
  stack.use(resource(() => {}));
});
