// The generators of the AoT compiler's schema and of its table of built-ins are files of the engine: Source/JavaScriptCore/aot/ir/generator and
// aot/builtins/generator in WebKit. Where that folder `aot` lies depends on the build: a checkout, or the tarball of a prebuilt WebKit in the cache.
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sharedCacheDir } from "../../scripts/build/config.ts";
import { prebuiltDirPrefix, WEBKIT_VERSION } from "../../scripts/build/deps/webkit.ts";

const flag = "--engine-directory=";
const checkoutFlag = "--javascriptcore=";
const inCheckout = (webkit: string): string => join(webkit, "Source", "JavaScriptCore", "aot");

function prebuiltInCache(): string | undefined {
  const cache = sharedCacheDir(resolve(import.meta.dirname, "..", ".."));
  const prefix = prebuiltDirPrefix(WEBKIT_VERSION);
  let names: string[];
  try {
    names = readdirSync(cache);
  } catch {
    return undefined;
  }
  return names
    .filter(name => name.startsWith(prefix))
    .map(name => inCheckout(join(cache, name)))
    .find(directory => existsSync(join(directory, "builtins", "generator")));
}

function findEngineDirectory(): string {
  const valueOf = (name: string): string | undefined =>
    process.argv.find(argument => argument.startsWith(name))?.slice(name.length);
  const javaScriptCore = valueOf(checkoutFlag);
  const places: readonly (readonly [place: string, directory: () => string | undefined])[] = [
    [flag.slice(0, -1), () => valueOf(flag)],
    [checkoutFlag.slice(0, -1), () => javaScriptCore && join(javaScriptCore, "aot")],
    ["$AOT_ENGINE_DIRECTORY", () => process.env.AOT_ENGINE_DIRECTORY],
    ["$BUN_WEBKIT_PATH", () => process.env.BUN_WEBKIT_PATH && inCheckout(process.env.BUN_WEBKIT_PATH)],
    ["vendor/WebKit", () => inCheckout(resolve(import.meta.dirname, "..", "..", "vendor", "WebKit"))],
    // Where CI puts it for the machines that only run tests.
    ["aot-engine beside the Bun that runs this", () => join(dirname(realpathSync(process.execPath)), "aot-engine")],
    // The prebuilt WebKit of the pinned version, which a build of any profile extracted to the shared cache.
    ["the prebuilt WebKit in the build cache", prebuiltInCache],
  ];
  for (const [, find] of places) {
    const directory = find();
    if (directory !== undefined && directory !== "" && existsSync(join(directory, "builtins", "generator"))) {
      return resolve(directory);
    }
  }
  throw new Error(
    `the engine's folder Source/JavaScriptCore/aot, which has the generators, is in none of: ${places.map(([place]) => place).join(", ")}`,
  );
}

/** Source/JavaScriptCore/aot of the engine that this Bun is built with. */
export const engineDirectory: string = findEngineDirectory();

/** What import() takes for a file of that folder. */
export const engineFile = (path: string): string => pathToFileURL(join(engineDirectory, path)).href;
