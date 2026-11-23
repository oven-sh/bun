import { test, vi, jest, mock } from "bun:test";
const say = (n: string, f: () => any) => { try { console.log(n, String(f())); } catch (e: any) { console.log(n, "threw", e.name); } };
test("b", async () => { vi.doMock("./api.ts", () => ({ get: () => "last", other: () => "o" })); { const again: any = await import("./api.ts"); say("last", () => again.get()); } });
test("third", () => {});
