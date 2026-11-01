// What the printer pays for a string. A string literal with a character above U+007F is kept as
// UTF-16, and any other as bytes. The text of a file that is imported is kept as the bytes of the
// file. "bun" escapes what is not ASCII, "browser" writes it as UTF-8.
//
//   bun bench/snippets/transpiler-strings.mjs
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bench, group, run } from "../runner.mjs";

const samples = {
  ascii: "The quick brown fox jumps over the lazy dog. ",
  latin: "Füße über Äpfel: café à la crème. ",
  cjk: "吾輩は猫である。名前はまだ無い。",
};
const lengths = { short: 16, long: 4096 };
const total = 1 << 18;

const text = (sample, length) => sample.repeat(Math.ceil(length / sample.length)).slice(0, length);

for (const [size, length] of Object.entries(lengths)) {
  group(`string literals, ${size}`, () => {
    for (const [name, sample] of Object.entries(samples)) {
      const literal = JSON.stringify(text(sample, length));
      const source = `export default [${Array(total / length)
        .fill(literal)
        .join(",\n")}];`;
      for (const target of ["bun", "browser"]) {
        const transpiler = new Bun.Transpiler({ loader: "js", target });
        bench(`${name}, target ${target}`, () => transpiler.transformSync(source));
      }
    }
  });
}

const dir = mkdtempSync(join(tmpdir(), "transpiler-strings-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

group("text of a file", () => {
  for (const [name, sample] of Object.entries(samples)) {
    const file = join(dir, `${name}.txt`);
    writeFileSync(file, text(sample, total));
    for (const target of ["bun", "browser"]) {
      bench(`${name}, target ${target}`, () => Bun.build({ entrypoints: [file], target }));
    }
  }
});

group("sourcesContent of a source map", () => {
  for (const [name, sample] of Object.entries(samples)) {
    const file = join(dir, `${name}.js`);
    const line = `// ${text(sample, 64)}\nglobalThis.${name}?.();\n`;
    writeFileSync(file, line.repeat(total / line.length));
    bench(name, () => Bun.build({ entrypoints: [file], target: "bun", sourcemap: "inline" }));
  }
});

await run();
