import { AsyncLocalStorage } from "node:async_hooks";
const storage = new AsyncLocalStorage();
console.log(storage.getStore() === undefined);
storage.run({ size: 1.5 }, () => {
  console.log(storage.getStore().size + 1);
});
