// One name is imported and require under another name loads the module.
import { createHash } from "node:crypto";
const load = require;
const name = "node:" + ["cry", "pto"].join("");
console.log(createHash("sha1").update("x").digest("hex").length, load(name).createHmac("sha1", "k").update("x").digest("hex").length, typeof load(name).randomUUID());
