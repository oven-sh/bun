import { createRequire } from "module";

//#region rolldown:runtime
var __require = /* @__PURE__ */ createRequire(import.meta.url);

//#endregion
let peer = null;
try {
  __require.resolve("optional-peer");
  peer = __require("optional-peer");
} catch {}
console.log(peer && peer.name, peer && peer.inner);
