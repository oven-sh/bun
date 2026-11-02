// What TypeScript 4.0 to 5.6 writes around a require of a CommonJS file without the marker: an object with names, a function with names, and a proxy, whose traps run as often as the helper and the reads ask it.
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
require("./before.cjs");
const names = __importStar(require("./names.cjs"));
const whole = __importStar(require("./whole.cjs"));
const trapped = __importStar(require("./trapped.cjs"));
function show() {
  console.log(names.who() === names, (0, names.who)() === undefined, names.count, names.lost, names.hidden, typeof names.default);
  console.log(whole.who() === whole, whole.count, typeof whole.default, whole.default.who() === whole.default, whole.name, whole.length);
  console.log(trapped.who() === trapped, trapped.count, globalThis.traps.join(", "));
}
show();
require("./names.cjs").lost = "stored behind the import";
require("./names.cjs").count++;
require("./whole.cjs").count++;
require("./names.cjs").who = function other() {
  "use strict";
  return this === names ? names : "other";
};
show();
