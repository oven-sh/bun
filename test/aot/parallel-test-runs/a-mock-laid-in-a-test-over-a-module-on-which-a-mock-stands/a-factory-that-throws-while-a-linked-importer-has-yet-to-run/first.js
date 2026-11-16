import { vi } from "bun:test";
try { vi.doMock("./dep.js", () => { throw new Error("no mock today"); }); } catch (e) { console.log("SAID the call threw", e.message); }
console.log("SAID the call has returned");
