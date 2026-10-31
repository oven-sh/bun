import { bump, describe, Shared } from "./lib/shared";
bump();
postMessage(describe(new Shared("worker")) + ((globalThis as any).preloaded ? " preloaded" : ""));
