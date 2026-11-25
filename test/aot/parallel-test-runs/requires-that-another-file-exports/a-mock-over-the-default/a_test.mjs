import { mock, test } from "bun:test";
mock.module("./own-require.mjs", () => ({ default: (name) => "mocked " + name }));
test("the mock answers", async () => {
  const { read } = await import("./reader.mjs");
  console.log(read());
});
