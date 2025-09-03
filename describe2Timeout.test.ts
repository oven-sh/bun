test.concurrent(
  "this one fails due to timeout",
  async () => {
    await Bun.sleep(2000);
  },
  500,
);
test.concurrent("this one fails due to default timeout", async () => {
  await Bun.sleep(10_000);
});
