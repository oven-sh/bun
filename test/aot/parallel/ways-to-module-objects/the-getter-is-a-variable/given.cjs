"use strict";
require("./child.cjs");
function get() { return this.children.map((it) => JSON.stringify(it.exports)).join(); }
Object.defineProperty(module, "exports", { get });
