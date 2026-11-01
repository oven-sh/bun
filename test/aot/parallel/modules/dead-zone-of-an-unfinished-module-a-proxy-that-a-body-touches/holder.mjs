import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export const proxy = new Proxy({}, { get() { try { require(Buffer.from("Li93YXRjaGVyLm1qcw==", "base64").toString()); } catch (error) { console.log("the load threw", error.constructor.name); } return 1; } });
