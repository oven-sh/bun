// Registered via `--import` when codegen runs under Node. Provides:
//   - tsconfig path mappings ("bindgen"/"bindgenv2") that *.bind.ts rely on
//   - extensionless relative-import resolution (src/codegen/* imports omit .ts)
// Bun handles both natively so under Bun this is a no-op.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

if (process.versions.bun === undefined) {
  const { registerHooks } = await import("node:module");
  const here = import.meta.dirname;
  const map: Record<string, string> = {
    bindgen: pathToFileURL(path.join(here, "bindgen-lib.ts")).href,
    bindgenv2: pathToFileURL(path.join(here, "bindgenv2", "lib.ts")).href,
  };
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier in map) return { url: map[specifier], shortCircuit: true };
      if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
        const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
        if (!existsSync(base)) {
          for (const cand of [base + ".ts", base + ".js", path.join(base, "index.ts")]) {
            if (existsSync(cand)) return { url: pathToFileURL(cand).href, shortCircuit: true };
          }
        }
      }
      return next(specifier, context);
    },
  });
}
