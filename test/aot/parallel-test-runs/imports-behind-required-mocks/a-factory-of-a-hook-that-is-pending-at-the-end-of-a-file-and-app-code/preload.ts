import { beforeEach, mock } from "bun:test";
(globalThis as any).gate = Promise.withResolvers<void>();
beforeEach(() => {
  mock.module("./store.ts", async () => {
    await (globalThis as any).gate.promise;
    return { get: () => "of the hook", put: () => "put of the hook" };
  });
});
