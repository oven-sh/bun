import { test, vi } from "bun:test";
vi.mock("menu-of-the-day", () => ({ dish: () => "guest", price: () => 1 }));
test("a guest", async () => {
  vi.doMock("menu-of-the-day", () => ({ dish: () => "later guest", price: () => 2 }));
  const waiter: any = await import("./waiter.ts");
  console.log("order", waiter.order());
});
test("a later guest", async () => {
  const waiter: any = await import("./waiter.ts");
  const again: any = await import("menu-of-the-day");
  console.log("order", waiter.order(), again.dish(), again.price());
});
