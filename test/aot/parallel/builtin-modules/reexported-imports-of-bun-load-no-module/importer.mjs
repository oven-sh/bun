import { all, bun, custom, counted, version, argv } from "./exports-again.mjs";
import * as again from "./exports-again.mjs";
note("importer.mjs starts");
export const read = () => [all === Bun, bun === all, all.custom, custom, counted, typeof version, Array.isArray(argv), again.custom, again.all === all, typeof all.serve].join(" ");
