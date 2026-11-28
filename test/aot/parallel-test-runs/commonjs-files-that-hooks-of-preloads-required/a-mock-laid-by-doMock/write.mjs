import { writeFileSync } from "node:fs";
import { join } from "node:path";
writeFileSync(join(import.meta.dirname, "words.cjs"), "exports.word = 'real';\n");
