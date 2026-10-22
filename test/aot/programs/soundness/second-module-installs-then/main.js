import { o, show } from "./object.js";
async function use(tag) { show(tag, await o); }
await use("first");
await import("./install.js");
await use("second");
