// In an executable the factory was never called: the import rejected with "ENOENT reading .."
import { mock } from "bun:test";
let calls = 0;
mock.module("no-such-package-here", () => { calls++; return { x: 1 }; });
for (let i = 0; i < 2; i++) console.log((await import("no-such-package-here")).x, "calls", calls);
