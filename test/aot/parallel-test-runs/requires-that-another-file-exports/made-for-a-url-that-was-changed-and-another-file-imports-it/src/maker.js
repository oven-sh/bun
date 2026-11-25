import { createRequire } from "node:module";
const own = new URL(import.meta.url);
own.pathname = own.pathname.replace("maker.js", "other/start.cjs");
export const load = createRequire(own.href);
export const askOwn = () => load("./part.cjs").said;
