"use strict";
Object.defineProperty(module, "children", { get() { return "mine"; }, configurable: true });
require("./child.cjs");
Object.defineProperty(module, "own", { value: 5 });
exports.seen = [module.children, module.own, typeof module.id].join();
