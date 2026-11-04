"use strict";
require("./child.cjs");
function reads() { return this.children.length; }
Object.defineProperty(module, "exports", { get: reads });
