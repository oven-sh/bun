import { beforeEach, mock } from "bun:test";
beforeEach(() => {
  mock.module("./store.ts", async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
    return { get: () => "of the hook", put: () => "put of the hook" };
  });
});
