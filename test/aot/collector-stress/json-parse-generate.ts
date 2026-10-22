// bun test/aot/collector-stress/json-parse-generate.ts <width> ..: writes programs/data-from-outside/json-parse-type-argument-while-the-collector-runs-<width>.ts: the types of that width, followed by what follows the types in the program of width 1.
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const folder = join(import.meta.dir, "..", "programs", "data-from-outside");
const nameOf = (width: number) => join(folder, `json-parse-type-argument-while-the-collector-runs-${width}.ts`);
const kinds = ["string", "number", "string", "boolean", "string[]", "number", "string | null"];
const kidAt = (width: number, level: number) => (level === 4 ? 0 : level === 3 ? width >> 1 : width - 1);

function record(width: number, level: number): string {
  const members: string[] = [];
  for (let at = 0; at < width; at++) {
    if (level > 1 && at === kidAt(width, level)) members.push(`kid: Level${level - 1}`);
    else members.push(`f${at}: ${width === 1 ? "string" : kinds[at % kinds.length]}`);
  }
  return `interface Level${level} { ${members.join("; ")} }`;
}

const first = readFileSync(nameOf(1), "utf8");
const common = first.slice(first.indexOf("\n", first.indexOf("\nconst lastOf = ") + 1) + 1);
for (const width of process.argv.slice(2).map(Number)) {
  const last = width === 1 ? "leaf.f0" : kinds[(width - 1) % kinds.length] === "string" ? `leaf.f${width - 1}` : `String(leaf.f${width - 1})`;
  writeFileSync(
    nameOf(width),
    [
      `// Records of ${width} declared ${width === 1 ? "field" : "fields"} and as many undeclared keys, four deep, in arrays, tuples and dictionaries, are parsed by JSON.parse<T> while the collector runs as often as it can be made to.`,
      `import { validate } from "bun:bundle";`,
      ...[1, 2, 3, 4].map(level => record(width, level)),
      `const width: number = ${width};`,
      `const lastOf = (leaf: Level1): string => ${last};`,
      common,
    ].join("\n"),
  );
}
