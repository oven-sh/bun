test.concurrent(
  "this one fails due to timeout",
  async () => {
    await Bun.sleep(2000);
  },
  500,
);
test.concurrent(
  "this one also fails due to timeout",
  async () => {
    await Bun.sleep(4000);
  },
  1000,
);
