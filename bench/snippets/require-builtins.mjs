import { spawnSync } from "child_process";
import { writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";

for (let builtin of builtinModules) {
  const path = `/tmp/require.${builtin.replaceAll("/", "_")}.cjs`;
  await writeFile(
    path,
    `
const builtin = ${JSON.stringify(builtin)};
const now = performance.now();
require(builtin);
const end = performance.now();
process.stdout.write(JSON.stringify({ builtin, time: end - now }) + "\\n");
  `,
  );
  spawnSync(process.execPath, [path], {
    stdio: ["inherit", "inherit", "inherit"],
    env: {
      ...process.env,
      NODE_NO_WARNINGS: "1",
    },
  });
}
