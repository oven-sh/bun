beforeEach(async () => {
  await Bun.sleep(1000);
});
test(
  "abc",
  () => {
    throw new Error("abc");
  },
  { timeout: 50 },
);

await describe.forDebuggingExecuteTestsNow();
describe.forDebuggingDeinitNow();
