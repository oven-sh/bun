// What the rejection says is the mock's word on its factory, and was the loader's on a file that is not there
import { mock } from "bun:test";
mock.module("no-such-package-here", async () => { await 1; return 42; });
try { await import("no-such-package-here"); console.log("imported"); } catch (error) { console.log("rejected:", error?.message); }
