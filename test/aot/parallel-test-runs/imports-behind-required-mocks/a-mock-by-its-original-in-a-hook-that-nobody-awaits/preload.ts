import { beforeEach, mock, vi } from "bun:test";
beforeEach(() => {
  mock.module("./store.ts", async () => ({ ...(await vi.importActual<any>("./store.ts")), get: () => "of the hook" }));
});
