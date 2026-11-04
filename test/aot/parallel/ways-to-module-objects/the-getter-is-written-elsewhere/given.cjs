"use strict";
require("./child.cjs");
const descriptor = { get() { return this.children.map((it) => JSON.stringify(it.exports)).join(); } };
Object.defineProperty(module, "exports", descriptor);
