import { join } from "node:path";

import pkg from "../package.json";

const BUN_VERSION = (process.env.BUN_VERSION || Bun.version || process.versions.bun).replace(/^.*v/, "");

Bun.write(join(import.meta.dir, "..", "package.json"), JSON.stringify({ version: BUN_VERSION, ...pkg }, null, 2));
