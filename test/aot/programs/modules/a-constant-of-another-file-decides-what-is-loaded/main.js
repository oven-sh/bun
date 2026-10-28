// A `const` that another file exports decides a branch in every form an import can take, and the arm that is not taken loads nothing.
import fallback, { debug, debug as renamed, level, text, nothing, missing, big } from "./flags.js";
import { debug as throughExportFrom, other as throughRenamedExportFrom, fallback as defaultExportedAgain } from "./export-from.js";
import { debug as throughStar, second } from "./star.js";
import * as flags from "./flags.js";
import { flags as namespaceExportedAgain, imported as namespaceImportedAndExported } from "./namespace-again.js";
import { doubled, isLoud } from "./computed.js";

if (debug) require("./never.cjs");
if (renamed) await import("./never.mjs");
if (fallback !== 10) require("./never.cjs");
if (level > 3) require("./never.cjs");
if (text !== "quiet") require("./never.cjs");
if (nothing != null) require("./never.cjs");
if (missing !== undefined) require("./never.cjs");
if (big !== 12345678901234567890n) require("./never.cjs");
if (throughExportFrom) require("./never.cjs");
if (throughRenamedExportFrom !== 2) require("./never.cjs");
if (defaultExportedAgain !== 10) require("./never.cjs");
if (throughStar || second !== "second") require("./never.cjs");
if (flags.debug) require("./never.cjs");
if (flags["debug"]) require("./never.cjs");
if (flags?.debug) require("./never.cjs");
if (flags.default !== 10) require("./never.cjs");
if (namespaceExportedAgain.debug) require("./never.cjs");
if (namespaceImportedAndExported.level !== 3) require("./never.cjs");
if (doubled !== 6 || isLoud) require("./never.cjs");
const loaded = debug ? require("./never.cjs") : level === 3 ? require("./taken.cjs") : require("./never.cjs");
function later() {
  if (debug) return import("./never.mjs");
  return flags.level + doubled;
}
console.log(loaded, later(), typeof debug, { debug, level }, `${text}!`, [fallback, nothing, missing, big]);
