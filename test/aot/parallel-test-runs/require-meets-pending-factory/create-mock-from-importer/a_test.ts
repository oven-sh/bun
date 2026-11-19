import { jest, test, vi } from "bun:test";
test("a mock made from an importer", () => {
  vi.doMock("./kept", () => new Promise(() => {}));
  let said;
  try { said = "answers " + JSON.stringify(jest.createMockFromModule("./user")); } catch (error: any) { said = error.constructor.name + ": " + error.message.replace(/"[^"]*[\\/]/, '"'); }
  console.log("SAID", said);
  vi.doUnmock("./kept");
});
