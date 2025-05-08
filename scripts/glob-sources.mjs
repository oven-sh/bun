import { write, Glob } from "bun";
import { join, resolve, relative } from "path";
import { normalize } from "path/posix";

const root = resolve(import.meta.dirname, "..");
let total = 0;

async function globSources(output, patterns, exclude = []) {
  const paths = [];
  for (const pattern of patterns) {
    const glob = new Glob(pattern);
    for await (const path of glob.scan()) {
      if (exclude.some(ex => path.includes(ex))) {
        continue;
      }
      paths.push(path);
    }
  }
  total += paths.length;

  const sources = paths
    .map(path => normalize(relative(root, path)))
    .sort((a, b) => a.localeCompare(b))
    .join("\n");

  await write(join(root, "cmake", output), sources);
}

const start = performance.now();
await Promise.all([
  globSources("BunErrorSources.txt", ["packages/bun-error/*.{json,ts,tsx,css}", "packages/bun-error/img/*"]),
  globSources("NodeFallbacksSources.txt", ["src/node-fallbacks/*.js"]),
  globSources("ZigGeneratedClassesSources.txt", [
    "src/bun.js/*.classes.ts",
    "src/bun.js/{api,node,test,webcore}/*.classes.ts",
  ]),
  globSources("JavaScriptSources.txt", ["src/js/**/*.{js,ts}"]),
  globSources("JavaScriptCodegenSources.txt", ["src/codegen/*.ts"]),
  globSources("BakeRuntimeSources.txt", ["src/bake/*.ts", "src/bake/*/*.{ts,css}"], ["src/bake/generated.ts"]),
  globSources("BindgenSources.txt", ["src/**/*.bind.ts"]),
  globSources("ZigSources.txt", ["src/**/*.zig"]),
  globSources("CxxSources.txt", [
    "src/io/*.cpp",
    "src/bun.js/modules/*.cpp",
    "src/bun.js/bindings/*.cpp",
    "src/bun.js/bindings/webcore/*.cpp",
    "src/bun.js/bindings/sqlite/*.cpp",
    "src/bun.js/bindings/webcrypto/*.cpp",
    "src/bun.js/bindings/webcrypto/*/*.cpp",
    "src/bun.js/bindings/node/*.cpp",
    "src/bun.js/bindings/node/crypto/*.cpp",
    "src/bun.js/bindings/v8/*.cpp",
    "src/bun.js/bindings/v8/shim/*.cpp",
    "src/bake/*.cpp",
    "src/deps/*.cpp",
    "packages/bun-usockets/src/crypto/*.cpp",
  ]),
  globSources("CSources.txt", [
    "packages/bun-usockets/src/*.c",
    "packages/bun-usockets/src/eventing/*.c",
    "packages/bun-usockets/src/internal/*.c",
    "packages/bun-usockets/src/crypto/*.c",
    "src/bun.js/bindings/uv-posix-polyfills.c",
    "src/bun.js/bindings/uv-posix-stubs.c",
  ]),
]);
const end = performance.now();

const green = "\x1b[32m";
const reset = "\x1b[0m";
const bold = "\x1b[1m";
console.log(`\nGlobbed ${bold}${green}${total}${reset} sources [${(end - start).toFixed(2)}ms]`);
