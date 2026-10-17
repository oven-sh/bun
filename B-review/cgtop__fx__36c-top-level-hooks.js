const { describe, it, afterEach } = require("node:test");

// This file fails on purpose. Tests of a suite, and a module-level and a
// suite-level afterEach hook that read their outcome. The process prints what
// the hooks saw.
const seen = [];
function record(where, ctx) {
  const { passed, error } = ctx;
  const cause = error?.cause;
  seen.push(
    JSON.stringify({
      where,
      name: ctx.name,
      passed,
      code: error?.code,
      failureType: error?.failureType,
      message: error?.message,
      cause: cause instanceof Error ? `${cause.name}: ${cause.message}` : cause,
    }),
  );
}

afterEach(ctx => record("file", ctx));

describe("suite", () => {
  afterEach(ctx => {
    record("suite", ctx);
    if (ctx.name === "afterEach throws") throw new Error("from afterEach");
  });
  it("throws", () => {
    throw new TypeError("boom");
  });
  it("passes", () => {});
  it("fails as expected", { expectFailure: true }, () => {
    throw new Error("expected");
  });
  it("only a subtest fails", async t => {
    await t.test("inner", () => {
      throw new Error("from inner");
    });
  });
  it("times out", { timeout: 5 }, () => new Promise(() => {}));
  it("afterEach throws", t => {
    t.after(() => record("own after", t));
  });
});

process.on("exit", () => {
  for (const line of seen) console.log("SEEN " + line);
});
