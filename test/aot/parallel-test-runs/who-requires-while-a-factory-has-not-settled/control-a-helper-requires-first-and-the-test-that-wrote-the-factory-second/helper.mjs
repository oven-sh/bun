import { vi } from "bun:test";
export const byHelper = name => { try { return require(name).seen; } catch (error) { return "threw " + error.name; } };
