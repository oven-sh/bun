import { test, vi } from "bun:test";
vi.mock("tins", () => ({ weigh: (v: number) => v + 100 }));
vi.mock("tins/scale.cjs", () => { console.log("factory below"); return { weigh: (v: number) => v + 1000 }; });
import { jar } from "jars";
test("a", async () => {
  console.log("a", jar(1), JSON.stringify((globalThis as any).ran ?? []));
});
