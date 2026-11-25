import { createRequire } from "node:module";
export const first = createRequire.call(undefined, import.meta.url);
