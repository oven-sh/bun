"use strict";
require("./child.cjs");
const kept = Object.defineProperty(module, "exports", { get() { return "given"; } });
globalThis.seen = [kept === module, kept.children.map((it) => JSON.stringify(it.exports)).join()].join();
