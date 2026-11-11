import { test, vi } from "bun:test";
import { f, g } from "./dep";
const look = (label: string, read: () => unknown) => {
  try {
    const value = read();
    console.log(label, typeof value, typeof value === "function" ? String((value as any)()) : String(value));
  } catch (e) {
    console.log(label, "threw", (e as Error).constructor.name, String((e as Error).message).split("\n")[0]);
  }
};
test("t", async () => {
  vi.doMock("./dep", () => ({ f: () => "m1" }));
  const first: any = await import("./dep");
  vi.doUnmock("./dep");
  look("spy", () => { vi.spyOn(first, "f").mockReturnValue("spied f"); return "laid"; });
  look("first.g", () => first.g);
  look("first.f", () => first.f);
  look("f", () => f());
  look("g", () => g());
});
