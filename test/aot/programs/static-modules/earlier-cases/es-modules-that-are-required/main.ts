// ES modules that CommonJS files require: the marker, an export named "module.exports", and the object that importers see.
// @ts-nocheck
declare const console: { log(...values: unknown[]): void };
import * as plain from "./plain";
import * as never from "./never";
import * as whole from "./whole";
import { requirePlain, requireWhole, requireSays, describe, remove } from "./reader.cjs";
import { again } from "./second.cjs";
const interop = (m) => (m && m.__esModule ? m.default : m);
const value = [plain][0], dynamic = await import("./plain");
console.log("before:", String(value.__esModule), String(dynamic.__esModule), typeof interop(dynamic), typeof interop(await import("./never")));
console.log("require:", requirePlain());
console.log("after:", String(value.__esModule), String(dynamic.__esModule), "__esModule" in value, typeof interop(dynamic), Object.keys(value).join());
console.log("never:", String([never][0].__esModule), typeof interop([never][0]));
console.log("whole:", requireWhole(), Object.keys([whole][0]).join());
console.log("says:", requireSays());
console.log("described:", describe()); console.log("from another file:", again(), again());
console.log("deleted:", remove());
