// usage: bun gen-test.mjs <out.ts>   writes the test file from final-rows.mjs
import { groups, metadata, ACCESSOR_X, STATIC_ACCESSOR_X } from "./final-rows.mjs";
import { writeFileSync } from "node:fs";
// A string literal the way prettier keeps it: double quotes unless single quotes need fewer escapes.
const q = s => {
  const json = JSON.stringify(s);
  const doubles = (s.match(/"/g) ?? []).length;
  const singles = (s.match(/'/g) ?? []).length;
  if (doubles > singles) return "'" + json.slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'") + "'";
  return json;
};
const template = s => "`" + s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`";
const cell = s => (s === ACCESSOR_X ? "accessorX" : s === STATIC_ACCESSOR_X ? "staticAccessorX" : q(s));
let out = `import { describe, expect, test } from "bun:test";

// Every source is TypeScript that tsc 6.0.2 parses without a diagnostic.

const tsconfig = JSON.stringify({ compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } });
const transpilers = {
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx" }),
  decorators: new Bun.Transpiler({ loader: "ts", tsconfig }),
};

/** A transpiler, a source, and what Bun prints for the program that tsc reads in the source. */
type Row = [transpiler: keyof typeof transpilers, source: string, expected: string];

/** What \`class C { accessor x: T; }\` is lowered to where the class has no decorators. */
const accessorX = ${template(ACCESSOR_X)};

/** What \`class C { static accessor x = 1; }\` is lowered to where the class has no decorators. */
const staticAccessorX = ${template(STATIC_ACCESSOR_X)};

/** The value that \`code\` passes for the metadata \`key\`, on one line. */
function design(code: string, key: string): string {
  const match = new RegExp(\`\\\\("design:\${key}", ([^]*?)\\\\),?\\\\n\`).exec(code);
  if (!match) throw new Error(\`no design:\${key} in\\n\${code}\`);
  return match[1]
    .replace(/\\s+/g, " ")
    .replace(/^\\[ /, "[")
    .replace(/ \\]$/, "]");
}

describe("TypeScript that tsc parses", () => {
`;
for (const [group, rows] of groups) {
  out += `  test.each<Row>([\n`;
  for (const row of rows) {
    if (!Array.isArray(row)) out += `    // ${row.comment}\n`;
    else out += `    [${q(row[0])}, ${cell(row[1])}, ${cell(row[2])}],\n`;
  }
  out += `  ])(${q(group + ": %s %j")}, (transpiler, source, expected) => {\n    expect(transpilers[transpiler].transformSync(source)).toBe(expected);\n  });\n\n`;
}
out += `  // Each tag is the one of tsc with strictNullChecks off; a name that tsc guards has the guard of Bun.\n`;
out += `  test.each<[source: string, key: string, expected: string]>([\n`;
for (const row of metadata) {
  if (!Array.isArray(row)) out += `    // ${row.comment}\n`;
  else out += `    [${q(row[0])}, ${q(row[1])}, ${q(row[2])}],\n`;
}
out += `  ])("decorator metadata: %j passes design:%s", (source, key, expected) => {\n    expect(design(transpilers.decorators.transformSync(source), key)).toBe(expected);\n  });\n});\n`;
writeFileSync(process.argv[2], out);
console.log(out.split("\n").length, "lines");
