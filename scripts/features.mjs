// @bun
// Used to generate a features.json file after building Bun.

import { writeFileSync } from "node:fs";
import { crash_handler } from "bun:internal-for-testing";

writeFileSync("./features.json", JSON.stringify(crash_handler.getFeatureData()));
