import { test, vi } from "bun:test";
test("a day", async () => {
  const waiter: any = await import("./waiter.ts");
  console.log("order", waiter.order());
  vi.resetModules();
  const again: any = await import("./waiter.ts");
  const menuAgain: any = await import("menu-of-the-day");
  console.log("reset", again.order(), menuAgain.dish(), menuAgain.price());
});
test("another day", async () => {
  const waiter: any = await import("./waiter.ts");
  console.log("another", waiter.order());
});
