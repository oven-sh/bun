// Two types of the engine under one qualified name break the one definition rule without a word from the compiler or the
// linker: wherever a template over the name is not inlined, one instantiation serves both. Two structs named
// JSC::AOT::Typed::AllocationUse, of 12 and of 24 bytes, shared Vector's buffer code so: an optimized build hid it.
// Goes by the text: `namespace` lines and closing braces at column 0, and definitions that begin at column 0.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const sources = [process.env.BUN_WEBKIT_PATH, join(import.meta.dir, "..", "..", "vendor", "WebKit")]
  .filter(path => path !== undefined)
  .map(path => join(path, "Source", "JavaScriptCore", "aot"))
  .find(path => existsSync(join(path, "ir")));
if (!sources) {
  console.error(
    "SKIPPED: test/aot/engine-types-are-defined-once.test.ts: there is no Source/JavaScriptCore/aot in $BUN_WEBKIT_PATH or vendor/WebKit",
  );
}

const definition =
  /^(?:template<[^>]*>\s*)?(?:struct|class|union|enum class|enum)\s+(?:alignas\([^)]*\)\s+)?(?:JS_EXPORT_PRIVATE\s+)?([A-Za-z_]\w*)\s*(?:final\s*)?(?::[^:]|\{|$)/;

test.skipIf(!sources)("no two files of the engine define a type under one qualified name", () => {
  const filesOf = new Map<string, Set<string>>();
  for (const file of new Bun.Glob("**/*.{h,cpp}").scanSync(sources!)) {
    const namespaces: string[] = [];
    for (const line of readFileSync(join(sources!, file), "utf8").split("\n")) {
      if (line.startsWith("namespace")) {
        for (const [, name] of line.matchAll(/namespace\s*([A-Za-z_][\w:]*)?\s*\{/g))
          namespaces.push(name ?? "(anonymous)");
      } else if (line.startsWith("}") && line.includes("namespace")) {
        namespaces.length = Math.max(0, namespaces.length - line.split("//")[0].split("}").length + 1);
      } else if (!namespaces.includes("(anonymous)") && !line.trimEnd().endsWith(";")) {
        const name = definition.exec(line)?.[1];
        if (!name) continue;
        const qualified = [...namespaces, name].join("::");
        if (!filesOf.has(qualified)) filesOf.set(qualified, new Set());
        filesOf.get(qualified)!.add(file);
      }
    }
  }
  expect(filesOf.size).toBeGreaterThan(1000);
  expect(
    [...filesOf]
      .filter(([, files]) => files.size > 1)
      .map(([name, files]) => `${name}: ${[...files].sort().join(", ")}`),
  ).toEqual([]);
});
