import { createRequire } from "node:module";
import whole, { basename } from "node:path";
import * as star from "node:path";

export const byName = file => basename(file);
export const byDefault = file => whole.basename(file);
export const byStar = file => star.dirname(file);
export const byRequire = file => createRequire(import.meta.url)("node:path").extname(file);
