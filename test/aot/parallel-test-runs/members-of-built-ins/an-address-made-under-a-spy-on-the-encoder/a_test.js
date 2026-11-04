import { spyOn, test } from "bun:test";
test("a spy on the encoder that calls through counts the call", async () => {
  const spy = spyOn(globalThis, "encodeURIComponent");
  const found = await import("data:text/javascript," + encodeURIComponent("export default 'written';"));
  console.log(found.default, spy.mock.calls.length);
  spy.mockRestore();
});
