// What a constant fold of a `define` string costs. The string is kept as its bytes, so a fold that
// reads a code unit counts the code units before it, on every fold.
//
//   bun bench/snippets/transpiler-define-folds.mjs
import { bench, group, run } from "../runner.mjs";

const text = (sample, length) => sample.repeat(Math.ceil(length / sample.length)).slice(0, length);

const ascii = "The quick brown fox jumps over the lazy dog. ";
const latin = "Füße über Äpfel: café à la crème. ";
// The string of each kind that has `length` UTF-16 code units.
const samples = {
  ascii: length => text(ascii, length),
  "é, then ascii": length => "é" + text(ascii, length - 1),
  "ascii, then é": length => text(ascii, length - 1) + "é",
  latin: length => text(latin, length),
  cjk: length => text("吾輩は猫である。名前はまだ無い。", length),
  // Two code units each.
  astral: length => text("😀🎉🚀🌍", length),
};
const lengths = [16, 4096, 8192];
// Folds in one source. Each fold reads the whole string once, so twice the folds is twice the time.
const counts = [1024, 2048];

const folds = {
  "X[n]": n => `X[${n}]`,
  "X.charCodeAt(n)": n => `X.charCodeAt(${n})`,
  "X.length": () => "X.length",
  // Y is X with another last character.
  "X < Y": () => "X < Y",
};

function source(fold, length, count, prelude = "") {
  let lines = prelude + "let a;\n";
  for (let i = 0; i < count; i++) lines += `a = ${fold(Math.floor((i * length) / count))};\n`;
  return lines;
}

for (const [name, fold] of Object.entries(folds)) {
  for (const length of lengths) {
    group(`${name}, ${length} code units`, () => {
      for (const [sampleName, sample] of Object.entries(samples)) {
        const x = sample(length);
        const y = x.slice(0, -2) + "!!";
        const transpiler = new Bun.Transpiler({
          loader: "js",
          target: "bun",
          minify: { syntax: true },
          define: { X: JSON.stringify(x), Y: JSON.stringify(y) },
        });
        for (const count of counts) {
          const code = source(fold, length, count);
          bench(`${sampleName}, ${count} folds`, () => transpiler.transformSync(code));
        }
      }
      // A literal that is not ASCII is UTF-16: `.length` and `<` fold on it, an index does not.
      const literal = text(latin, length);
      const prelude = `const X = ${JSON.stringify(literal)}, Y = ${JSON.stringify(literal.slice(0, -2) + "!!")};\n`;
      const transpiler = new Bun.Transpiler({ loader: "js", target: "bun", minify: { syntax: true } });
      for (const count of counts) {
        const code = source(fold, length, count, prelude);
        bench(`latin literal, ${count} folds`, () => transpiler.transformSync(code));
      }
    });
  }
}

await run();
