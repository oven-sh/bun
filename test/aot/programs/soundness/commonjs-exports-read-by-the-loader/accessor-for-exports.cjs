"use strict";
globalThis.assembled = 0;
function assembleStyles() {
  globalThis.assembled++;
  return { red: { open: "<red>", close: "</red>" } };
}
Object.defineProperty(module, "exports", { enumerable: true, get: assembleStyles });
