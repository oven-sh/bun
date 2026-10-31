globalThis.log ??= []; const note = s => globalThis.log.push(s); import { s } from "./slow.mjs"; note("user " + s);
