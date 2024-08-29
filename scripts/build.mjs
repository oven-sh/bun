import { spawnSync } from "node:child_process";
import { join } from "node:path";

let script;
if (process.platform === "win32") {
  script = "build.ps1";
} else {
  script = "build.sh";
}

const scriptPath = join(import.meta.dirname, script);
const { status } = spawnSync(scriptPath, process.argv.slice(2), {
  stdio: "inherit",
  env: {
    ...process.env,
    FORCE_COLOR: "1",
    CLICOLOR_FORCE: "1",
  },
});

process.exit(status ?? 1);
