import { createRequire } from "node:module";
const held = [createRequire(import.meta.url)];
Object.defineProperty(globalThis, "loadsConsumer", { configurable: true, get() { held[0]("./consumer.mjs"); return 1; } });
