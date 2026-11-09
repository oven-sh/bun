import { mock, test } from "bun:test";
test("what the second file finds", async () => {
  const { read } = await import("./reader.mjs");
  console.log(read());
});
