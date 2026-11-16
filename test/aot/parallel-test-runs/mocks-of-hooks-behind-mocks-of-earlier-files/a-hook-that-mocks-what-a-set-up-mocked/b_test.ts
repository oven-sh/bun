import { test, vi } from "bun:test";
import * as menu from "./menu.ts";
test("a day", async () => {
  console.log("day", menu.dish());
  const waiter: any = await import("./waiter.ts");
  console.log("order", waiter.order());
  vi.resetModules();
  const again: any = await import("./waiter.ts");
  const menuAgain: any = await import("./menu.ts");
  console.log("reset", again.order(), menuAgain.dish(), menuAgain.price());
});
test("another day", async () => {
  const waiter: any = await import("./waiter.ts");
  console.log("another", menu.dish(), waiter.order());
});
