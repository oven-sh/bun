import { v, f } from "./main.mjs"; export const seen = () => [typeof f, f(), (() => { try { return v; } catch (e) { return e.constructor.name; } })()];  export const early = seen().join();
