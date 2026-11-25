import { jest, test, vi } from "bun:test";

test("both have the same functions", async () => {
  const imported = await vi.importActual<any>("bun");
  console.log(jest.requireActual("bun").escapeHTML === imported.escapeHTML);
});
