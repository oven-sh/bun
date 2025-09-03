test.concurrent(
  "this one fails due to timeout",
  async () => {
    await Bun.sleep(2000);
  },
  500,
);
test.concurrent("this one triggers the other one to notice", async () => {
  await Bun.sleep(1000);
});
