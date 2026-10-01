// usage: <bun> named-cost.ts <H>: the processor time of enumerateCase over the sample of one case in 40 and over the named cases.
import { readdirSync } from "node:fs";
import { join } from "node:path";
const home = process.argv[2];
const { enumerateCase } = await import(join(home, "runner/compiler_runner"));
const { skippedEmitTests } = await import(join(home, "runner/harnessutil_options"));
const casesDir = join(home, "corpus/cases");
const cases = new Map<string, string>();
const walk = (rel: string) => {
  for (const entry of readdirSync(`${casesDir}/${rel}`, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(`${rel}/${entry.name}`);
    else if (/\.tsx?$/.test(entry.name)) cases.set(entry.name, `${rel}/${entry.name}`);
  }
};
walk("compiler");
walk("conformance");
const hashed = [...cases.values()].filter(p => Bun.hash.crc32(p) % 40 === 0);
const named = ["emitHelpersWithLocalCollisions.ts", "callChainWithSuper.ts", "esmModuleExports2.ts", "moduleResolutionWithSuffixes_one.ts", "pathMappingInheritedBaseUrl.ts", "tsconfigExtendsPackageJsonExportsWildcard.ts", "declarationEmitSymlinkPaths.ts", "bom-utf16be.ts", "bom-utf16le.ts", ...skippedEmitTests.keys()].map(n => cases.get(n)!);
for (const [label, paths] of [["one case in 40", hashed], ["the named cases", named], ["one case in 40, again", hashed], ["the named cases, again", named]] as const) {
  const c0 = process.cpuUsage();
  let n = 0;
  for (const p of paths) n += enumerateCase(casesDir, p).length;
  const c = process.cpuUsage(c0);
  console.log(`${label}: ${paths.length} cases, ${n} instances, user+sys ${((c.user + c.system) / 1000).toFixed(0)} ms`);
}
