import { writeFileSync } from "node:fs";
import { join } from "node:path";
writeFileSync(join(import.meta.dir, "sides.mjs"), "export const width = 1; export const height = 2;");
