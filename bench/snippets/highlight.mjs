import hljs from "highlight.js";
import Prism from "prismjs";
import "prismjs/components/prism-typescript.js";
import { createHighlighter } from "shiki";
import { bench, run, summary } from "../runner.mjs";

const theme = typeof Bun !== "undefined" && Bun.highlight ? new Bun.highlight.Theme("dark", { colorDepth: 24 }) : null;
const shiki = await createHighlighter({ themes: ["github-dark"], langs: ["typescript"] });

const small = `const greet = (name: string) => "Hello, " + name;`;

const medium = `import { readFile } from "node:fs/promises";

interface Options<T> {
  retries?: number;
  parse(text: string): T;
}

/** Reads a file and parses it, trying again if that fails. */
export async function load<T>(path: string, { retries = 3, parse }: Options<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return parse(await readFile(path, "utf8"));
    } catch (error) {
      if (attempt >= retries) throw new Error(\`cannot load \${path}\`, { cause: error });
    }
  }
}

export class Cache<K, V> extends Map<K, V> {
  #hits = 0;
  override get(key: K) {
    if (this.has(key)) this.#hits++;
    return super.get(key);
  }
  get hits() {
    return this.#hits;
  }
}
`;

const large = medium.repeat(200);
// A JavaScript string with a character outside Latin-1 is UTF-16.
const utf16 = `// ✓\n${large}`;

for (const [name, code] of [
  ["small", small],
  ["medium", medium],
  ["large", large],
  ["large, UTF-16", utf16],
]) {
  const label = `${name} (${code.length} chars)`;
  summary(() => {
    if (typeof Bun !== "undefined" && Bun.highlight) {
      bench(`${label} - Bun.highlight.html`, () => Bun.highlight.html(code, "ts"));
      bench(`${label} - Bun.highlight.Theme#ansi`, () => theme.ansi(code, "ts"));
    }
    bench(`${label} - highlight.js`, () => hljs.highlight(code, { language: "typescript" }).value);
    bench(`${label} - prismjs`, () => Prism.highlight(code, Prism.languages.typescript, "typescript"));
    bench(`${label} - shiki`, () => shiki.codeToHtml(code, { lang: "typescript", theme: "github-dark" }));
  });
}

await run();
