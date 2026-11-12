import { vi } from "bun:test";
vi.doMock("./dep.js", async () => (console.log("SAID the factory runs"), await null, { who: "later" }));
console.log("SAID the call has returned");
