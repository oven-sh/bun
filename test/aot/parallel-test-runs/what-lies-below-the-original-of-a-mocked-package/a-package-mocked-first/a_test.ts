import { test, vi } from "bun:test";
vi.mock("scales", () => { console.log("factory below"); return { weigh: (v: number) => v + 1000 }; });
vi.mock("tins", () => ({ weigh: (v: number) => v + 100 }));
import { jar } from "jars";
test("a", async () => {
  console.log("a", jar(1), JSON.stringify((globalThis as any).ran ?? []));
});
