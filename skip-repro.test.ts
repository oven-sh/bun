test.skip("skip", () => {
  throw new Error("skip");
});

describe.skip("skipped describe", () => {
  test("skipped test", () => {
    throw new Error("skipped test");
  });
});
