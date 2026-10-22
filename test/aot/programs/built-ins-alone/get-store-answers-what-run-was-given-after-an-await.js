import { AsyncLocalStorage } from "node:async_hooks";
const storage = new AsyncLocalStorage();
await storage.run({ size: 1.5 }, async () => {
  await null;
  console.log(storage.getStore().size + 1);
});
