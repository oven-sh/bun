// In an executable the factory was never called: the require threw "Cannot find module .."
import { mock } from "bun:test";
let calls = 0;
mock.module("no-such-package-here", () => { calls++; return { x: 1 }; });
for (let i = 0; i < 2; i++) console.log(require("no-such-package-here").x, "calls", calls);
