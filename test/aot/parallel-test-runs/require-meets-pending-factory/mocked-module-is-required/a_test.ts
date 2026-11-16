import { jest, test, vi } from "bun:test";
test("the mocked module", () => {
  vi.doMock("./kept", () => new Promise(() => {}));
  let said;
  try { said = "answers " + JSON.stringify(require("./kept")); } catch (error: any) { said = error.constructor.name + ": " + error.message.replace(/"[^"]*[\\/]/, '"'); }
  console.log("SAID", said);
  vi.doUnmock("./kept");
});
