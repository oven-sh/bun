// `bun lint` with a JavaScript plugin over real source files. The plugin's token, comment and report locations
// are converted from byte to UTF-16 offsets by `Utf16OffsetTable`, which is the only thing this changes.
//
//   BUN=/path/to/main/bun bun bench/snippets/utf16-offsets-lint.mjs
//   BUNS=base=/path/to/main/bun,new=/path/to/branch/bun bun bench/snippets/utf16-offsets-lint.mjs
//   CORPUS=/some/dir FILES=500 THREADS=1 bun bench/snippets/utf16-offsets-lint.mjs
//
// Release builds. Defaults to the first FILES (sorted) .js/.mjs/.ts files of the repo's test/ directory, which have
// the non-ASCII text that real code has. The same file list is printed, so two runs can be compared.
// mitata runs the binaries one after the other, not interleaved; run it twice, in the other order, to see drift.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { bench, group, run } from "../runner.mjs";

const files = Number(process.env.FILES ?? 300);
const threads = process.env.THREADS ?? "1";
const corpus = resolve(process.env.CORPUS ?? join(import.meta.dirname, "../../test"));
const buns = (process.env.BUNS ?? `bun=${process.env.BUN ?? process.execPath}`).split(",").map(entry => {
  const at = entry.indexOf("=");
  return { label: entry.slice(0, at), path: entry.slice(at + 1) };
});

const plugin = `export default {
  meta: { name: "demo" },
  rules: {
    touch: {
      meta: { schema: false },
      create(context) {
        const { sourceCode } = context;
        return {
          Program(node) {
            if (sourceCode.ast.tokens.length + sourceCode.getAllComments().length < 0) context.report({ node, message: "never" });
          },
          FunctionDeclaration(node) {
            if (node.id) context.report({ node: node.id, message: "fn" });
          },
        };
      },
    },
  },
};
`;

const dir = mkdtempSync(join(tmpdir(), "utf16-offsets-lint-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
writeFileSync(join(dir, "plugin.mjs"), plugin);
writeFileSync(
  join(dir, "eslint.config.mjs"),
  `import demo from "./plugin.mjs";\nexport default [{ ignores: ["plugin.mjs"], plugins: { demo }, rules: { "demo/touch": "warn" } }];\n`,
);

const listed = Array.from(new Bun.Glob("**/*.{js,mjs,ts}").scanSync({ cwd: corpus }))
  .filter(name => !name.includes("node_modules"))
  .sort()
  .slice(0, files);
let bytes = 0;
let nonAscii = 0;
let nonAsciiBytes = 0;
listed.forEach((name, i) => {
  const text = readFileSync(join(corpus, name));
  const extra = text.reduce((n, byte) => n + (byte >= 0x80), 0);
  bytes += text.length;
  nonAscii += extra > 0;
  nonAsciiBytes += extra;
  mkdirSync(join(dir, "src"), { recursive: true });
  copyFileSync(join(corpus, name), join(dir, "src", `${i}-${basename(name)}`));
});
console.log(
  `${listed.length} files from ${corpus}, ${(bytes / 1024).toFixed(0)} KiB, ${nonAscii} with non-ASCII text ` +
    `(${nonAsciiBytes} bytes), ${threads} thread(s)\n`,
);

const lint = bun =>
  spawnSync(bun.path, ["lint", "--threads", threads, "-f", "json", "src"], {
    cwd: dir,
    encoding: "utf8",
    maxBuffer: 1 << 30,
    env: { ...process.env, AGENT: "0", NO_COLOR: "1" },
  });

// The same locations from every binary, or the comparison is meaningless.
const outputs = buns.map(bun => {
  const { status, stdout, stderr } = lint(bun);
  if (status !== 0 && status !== 1) throw new Error(`${bun.label}: exit ${status}\n${stderr}`);
  return stdout.replaceAll(dir, "");
});
if (outputs.some(output => output !== outputs[0])) throw new Error("the binaries report different locations");

group(`bun lint, ${listed.length} files`, () => {
  for (const bun of buns) bench(bun.label, () => void lint(bun));
});

await run();
