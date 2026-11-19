// Where no mock stands yet the loader says what it says of a name that finds nothing
import { mock } from "bun:test";
let calls = 0;
try { await import("no-such-package-here"); } catch (error) { console.log("rejects", error.name, error.code, "calls", calls); }
mock.module("no-such-package-here", () => { calls++; return { x: 1 }; });
console.log((await import("no-such-package-here")).x, "calls", calls);
