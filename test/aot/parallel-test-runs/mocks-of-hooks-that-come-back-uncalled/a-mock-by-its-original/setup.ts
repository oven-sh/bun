import { vi, jest, beforeEach } from "bun:test";
beforeEach(() => { vi.doMock("./api.ts", async (o: any) => ({ ...(await o()), get: () => "hook" })); });
