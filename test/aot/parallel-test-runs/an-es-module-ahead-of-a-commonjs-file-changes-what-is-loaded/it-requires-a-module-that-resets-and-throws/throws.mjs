import { vi } from "bun:test";
vi.resetModules();
require("./dep.mjs");
throw new Error("thrown");
