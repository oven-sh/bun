import { createRequire } from "node:module";
const loaded = createRequire(import.meta.url)("./rt/literal.cjs");
console.log(Object.keys(loaded).join(), Object.keys(loaded.default ?? {}).join());
