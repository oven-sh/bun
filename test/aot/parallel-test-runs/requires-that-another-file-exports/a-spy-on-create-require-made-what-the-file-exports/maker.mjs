import Module from "node:module";
export const load = Module.createRequire(import.meta.url);
