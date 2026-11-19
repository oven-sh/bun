import { s } from "./lamp.mjs";
globalThis.side = (() => { try { return s; } catch (error) { return error.name; } })();
