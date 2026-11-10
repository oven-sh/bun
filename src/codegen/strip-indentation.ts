import { tokenize } from "./lazy-function-table";

const transpiler = new Bun.Transpiler({ loader: "js", minifyWhitespace: true, deadCodeElimination: false });
const parsed = (source: string) => transpiler.transformSync(source.replaceAll("@", "$"));

/** Takes the blanks at the start of each line out of a bundled built-in. Every token stays on its line. */
export function stripIndentation(source: string): string {
  let out = "";
  let end = 0;
  try {
    for (const token of tokenize(source)) {
      out += source.slice(end, token.start).replace(/\n[ \t]+/g, "\n") + token.text;
      end = token.end;
    }
  } catch {
    return source;
  }
  out += source.slice(end);
  // The tokenizer can take code for a template literal, and the other way round.
  return parsed(out) === parsed(source) ? out : source;
}
