import { configOf } from "./configure.ts";
import { webkitAotFile, webkitJSCPath, webkitTestAotPath } from "./deps/webkit.ts";
import { BuildError } from "./error.ts";

function parseProfile(args: string[]): string {
  let profile = "debug";
  for (const arg of args) {
    if (!arg.startsWith("--profile=")) {
      console.error("usage: bun scripts/build/aot-paths.ts [--profile=<name>]");
      process.exit(1);
    }
    profile = arg.slice("--profile=".length);
  }
  return profile;
}

// stdout is read as NAME=<path> lines ($GITHUB_ENV, `export $(..)`), and resolving the toolchain can console.log.
console.log = console.error;

try {
  const { cfg } = configOf({ profile: parseProfile(process.argv.slice(2)) });
  const paths = {
    TESTAOT: webkitTestAotPath(cfg),
    JSC: webkitJSCPath(cfg),
    AOT_SCHEMA: webkitAotFile(cfg, "AOTSchema.def"),
    AOT_BUILTINS_GENERATED: webkitAotFile(cfg, "builtins-generated"),
    AOT_ENGINE_DIRECTORY: webkitAotFile(cfg, "directory"),
  };
  for (const [name, path] of Object.entries(paths)) process.stdout.write(`${name}=${path}\n`);
} catch (error) {
  if (!(error instanceof BuildError)) throw error;
  process.stderr.write(error.format());
  process.exit(1);
}
