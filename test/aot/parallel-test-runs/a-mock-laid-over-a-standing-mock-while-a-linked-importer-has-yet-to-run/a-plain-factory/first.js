import { vi } from "bun:test";
vi.doMock("./dep.js", () => ({ who: "later" }));
console.log("SAID the call has returned");
