import { test, vi } from "vitest";
import { root } from "./root.mjs";
vi.mock("./first.mjs", async () => {
  const actual = await vi.importActual("./first.mjs");
  return { ...actual, first: () => "mocked " + actual.first() };
});
vi.mock("./second.mjs", async importOriginal => ({ ...(await importOriginal()), added: 2 }));
vi.mock("./last.mjs", async importOriginal => ({ ...(await importOriginal()), added: 3 }));
test("reads", () => console.log("SAID", root()));
