import { Plain } from "./plain.mjs";
Object.defineProperty(Plain, Symbol.hasInstance, { value(value) { return typeof value.allowedNodeEnvironmentFlags.has === "function"; } });
