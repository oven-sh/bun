import { test, vi } from "bun:test";
import * as menu from "./menu.ts";
vi.mock("./menu.ts", () => ({ dish: () => "guest", price: () => 1 }));
test("a guest", async () => {
  console.log("guest", menu.dish());
  vi.doMock("./menu.ts", () => ({ dish: () => "later guest", price: () => 2 }));
  const waiter: any = await import("./waiter.ts");
  console.log("order", waiter.order());
});
test("a later guest", async () => {
  console.log("later", menu.dish());
  const waiter: any = await import("./waiter.ts");
  const again: any = await import("./menu.ts");
  console.log("order", waiter.order(), again.dish(), again.price());
});
