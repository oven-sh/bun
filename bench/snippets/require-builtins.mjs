import { spawnSync } from "child_process";
import { writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";

for (let builtin of builtinModules) {
  const path = `/tmp/require.${builtin.replaceAll("/", "_")}.cjs`;
  await writeFile(
    path,
    `
const builtin = ${JSON.stringify(builtin)};
const now = require("perf_hooks").performance.now();
require(builtin);
const end = require("perf_hooks").performance.now();
process.stdout.write(JSON.stringify({builtin, time: end - now}) + "\\n");
  `,
  );
  const result = spawnSync(typeof Bun !== "undefined" ? "bun" : "node", [path], {
    stdio: ["inherit", "inherit", "inherit"],
    env: {
      ...process.env,
      NODE_NO_WARNINGS: "1",
    },
  });
}
