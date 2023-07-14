import { AsyncLocalStorage } from "async_hooks";
import { bench, run } from "mitata";

bench("new AsyncLocalStorage()", () => {
  new AsyncLocalStorage();
});

const storage = new AsyncLocalStorage();
bench("storage.run()", () => {
  storage.run(1, () => {});
});

bench("storage.run() + storage.getStore()", async () => {
  await storage.run(1, async () => {
    for (let i = 0; i < 1000; i++) {
      await Promise.resolve(2).then(() => 1);
      storage.getStore();
    }
  });
});

// bench("await Promise.resolve().then(() => 1) * 1000", async () => {
//   for (let i = 0; i < 1000; i++) {
//     await Promise.resolve().then(() => 1);
//   }
// });

await run();
