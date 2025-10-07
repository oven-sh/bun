// @bun
// Used to generate a features.json file after building Bun.

import { crash_handler } from "bun:internal-for-testing";
import { writeFileSync } from "node:fs";

writeFileSync("./features.json", JSON.stringify(crash_handler.getFeatureData()));
