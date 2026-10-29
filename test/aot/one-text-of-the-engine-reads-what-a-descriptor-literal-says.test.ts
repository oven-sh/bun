// `Object.defineProperty(object, key, { .. })`: the passes read what the literal says by one text, readDescriptorLiteral().
// Flow reads the flags out of its own lists, and what it says of a field is compared with the definition at run time.
// Goes by the text of the engine's sources: whoever spells the name of a flag of a descriptor anywhere else has begun another.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { filesOfCompiler, sayWhenSkipped, sources } from "./harness/engine-text";

sayWhenSkipped("test/aot/one-text-of-the-engine-reads-what-a-descriptor-literal-says.test.ts");

test.skipIf(!sources)("the flags of a descriptor are named in two files", () => {
  const spelling = /\bBuiltinNames::(?:writable|enumerable|configurable)\b|"(?:writable|enumerable|configurable)"_s/;
  const names = [...filesOfCompiler()].map(file => file.name);
  expect(names.filter(name => spelling.test(readFileSync(join(sources!, name), "utf8")))).toEqual([
    "analysis/AOTDescriptorLiteral.cpp",
    "valueflow/AOTValueFlowResultsStores.cpp",
  ]);
});
