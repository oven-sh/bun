import { r } from "./roof.mjs";
globalThis.side = (() => { try { return r; } catch (error) { return error.name; } })();
