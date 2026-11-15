import { jest, mock, test, vi } from "bun:test";
test("the importer reads the mock while it loads", async () => {
  vi.doMock("./price.mjs", async () => ({ ...(await import("./price.mjs")), price: () => "mock price" }));
  const [cart, shop, prices] = await Promise.all([import("./cart.mjs"), import("./shop.mjs"), import("./price.mjs")]);
  console.log(cart.atLoad, shop.describe(), prices.price());
});
