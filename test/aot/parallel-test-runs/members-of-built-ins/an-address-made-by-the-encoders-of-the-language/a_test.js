import { test } from "bun:test";
test("an address made by the encoders of the language", async () => {
  const first = await import("data:text/javascript," + encodeURIComponent("export default 'written';"));
  const second = await import("data:text/javascript;base64," + btoa("export default 'in base64';"));
  console.log(first.default, second.default);
});
