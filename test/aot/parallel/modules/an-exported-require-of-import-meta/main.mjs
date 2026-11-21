// A require that a file takes off import.meta and exports finds what its importers ask it for.
import { __require } from "./chunk.mjs";
import * as chunk from "./chunk.mjs";
const ledger = () => __require("./ledger.cjs");
console.log(ledger().total, chunk.__require("./ledger.cjs") === ledger(), __require("node:path").basename("a/b"));
