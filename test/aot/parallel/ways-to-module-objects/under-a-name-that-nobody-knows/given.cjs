"use strict";
globalThis.pick = "exports";
Object.defineProperty(module, globalThis.pick, { get() { return "given"; } });
