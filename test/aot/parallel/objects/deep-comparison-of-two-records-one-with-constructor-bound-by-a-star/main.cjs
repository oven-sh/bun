// Two records of one literal take the exports of two CommonJS files through __exportStar, as TypeScript writes `export * from`, and only the second file exports "constructor". node:util's isDeepStrictEqual holds the constructor that the first record inherits against that export: it asks neither record for its Symbol.toStringTag, and what the records took from the files still waits to be bound.
// COUNT: counter:StarsRecorded = 2
// COUNT: counter:StarsCarriedOutLate = 0
"use strict";
const { isDeepStrictEqual } = require("node:util");

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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};

let tagReads = 0;
const above = { get [Symbol.toStringTag]() { tagReads++; return "Record"; } };
function taking(exported) {
  const record = Object.setPrototypeOf({ a: 1 }, above);
  __exportStar(exported, record);
  return record;
}
const inherits = taking(require("./one.cjs"));
const owns = taking(require("./one-and-constructor.cjs"));

console.log("the record whose file exports it is the second:", isDeepStrictEqual(inherits, owns), "and Symbol.toStringTag was read", tagReads, "times");
