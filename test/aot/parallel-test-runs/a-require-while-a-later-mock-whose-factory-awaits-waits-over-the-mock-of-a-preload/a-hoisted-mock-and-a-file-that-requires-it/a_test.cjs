const { test, vi, mock, jest } = require("bun:test");
vi.mock("./part.cjs", async real => ({ ...(await real()), a: "later" }));
test("t", async () => {
  const user = require("./user.cjs");
  console.log("SAID the user", user.a, user.later());
});
